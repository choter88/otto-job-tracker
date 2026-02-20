import type Database from "better-sqlite3";

export function bootstrapSqliteSchema(sqlite: Database.Database): void {
  const hasColumn = (table: string, column: string): boolean => {
    try {
      const rows = sqlite.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{ name?: string }>;
      return rows.some((r) => String(r.name || "").toLowerCase() === column.toLowerCase());
    } catch {
      return false;
    }
  };

  const ensurePatientFirstName = (table: string): void => {
    const hasFirstName = hasColumn(table, "patient_first_name");
    const hasFirstInitial = hasColumn(table, "patient_first_initial");
    if (hasFirstName || !hasFirstInitial) return;

    try {
      sqlite.prepare(`ALTER TABLE ${table} RENAME COLUMN patient_first_initial TO patient_first_name;`).run();
      return;
    } catch {
      // Fallback for older SQLite builds: add the new column and copy existing values.
    }

    sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN patient_first_name TEXT NOT NULL DEFAULT '';`).run();
    sqlite.prepare(
      `UPDATE ${table}
       SET patient_first_name = patient_first_initial
       WHERE (patient_first_name IS NULL OR patient_first_name = '')
         AND (patient_first_initial IS NOT NULL AND patient_first_initial != '');`,
    ).run();
  };

  const ensureJobFlagNoteColumns = (): void => {
    if (!hasColumn("job_flags", "important_note")) {
      sqlite.prepare(`ALTER TABLE job_flags ADD COLUMN important_note TEXT;`).run();
    }
    if (!hasColumn("job_flags", "important_note_updated_at")) {
      sqlite.prepare(`ALTER TABLE job_flags ADD COLUMN important_note_updated_at INTEGER;`).run();
    }

    // Preserve existing user-entered notes from legacy `summary`.
    sqlite.prepare(
      `UPDATE job_flags
       SET important_note = summary
       WHERE (important_note IS NULL OR important_note = '')
         AND summary IS NOT NULL
         AND summary != '';`,
    ).run();

    sqlite.prepare(
      `UPDATE job_flags
       SET important_note_updated_at = COALESCE(important_note_updated_at, summary_generated_at, created_at)
       WHERE important_note IS NOT NULL
         AND important_note != '';`,
    ).run();
  };

  const ensureHighContrastOfficeColors = (): void => {
    const normalizeHexColor = (value: unknown) =>
      String(typeof value === "string" ? value : "").trim().toLowerCase();

    const OFFICE_COLOR_MIGRATIONS: Record<
      string,
      Record<string, { from: string; to: string }>
    > = {
      customStatuses: {
        job_created: { from: "#e0e7ff", to: "#2563eb" },
        ordered: { from: "#fef3c7", to: "#d97706" },
        in_progress: { from: "#dbeafe", to: "#0284c7" },
        quality_check: { from: "#e0f2fe", to: "#7c3aed" },
        ready_for_pickup: { from: "#d1fae5", to: "#16a34a" },
        completed: { from: "#bbf7d0", to: "#059669" },
        cancelled: { from: "#fee2e2", to: "#dc2626" },
      },
      customJobTypes: {
        contacts: { from: "#e0e7ff", to: "#475569" },
        glasses: { from: "#d1fae5", to: "#2563eb" },
        sunglasses: { from: "#f3e8ff", to: "#d97706" },
        prescription: { from: "#fef3c7", to: "#7c3aed" },
      },
      customOrderDestinations: {
        vision_lab: { from: "#e0e7ff", to: "#0284c7" },
        eyetech_labs: { from: "#d1fae5", to: "#16a34a" },
        premium_optics: { from: "#fef3c7", to: "#d97706" },
      },
    };

    const officeRows = sqlite
      .prepare("SELECT id, settings FROM offices")
      .all() as Array<{ id: string; settings: string }>;

    const updateOfficeSettings = sqlite.prepare(
      `UPDATE offices
       SET settings = ?, updated_at = (unixepoch() * 1000)
       WHERE id = ?;`,
    );

    for (const office of officeRows) {
      let settings: any = {};
      try {
        settings = office.settings ? JSON.parse(office.settings) : {};
      } catch {
        continue;
      }

      let changed = false;

      for (const [settingsKey, byId] of Object.entries(OFFICE_COLOR_MIGRATIONS)) {
        const list = Array.isArray(settings?.[settingsKey]) ? settings[settingsKey] : [];
        if (!Array.isArray(list) || list.length === 0) continue;

        for (const item of list) {
          const id = String(item?.id || "");
          const migration = byId[id];
          if (!migration) continue;

          const current = normalizeHexColor(item?.color);
          if (current !== migration.from) continue;

          item.color = migration.to;
          changed = true;
        }

        settings[settingsKey] = list;
      }

      if (!changed) continue;

      updateOfficeSettings.run(JSON.stringify(settings), office.id);
    }
  };

  const statements: string[] = [
    `PRAGMA foreign_keys = ON;`,
    `PRAGMA journal_mode = WAL;`,

    `CREATE TABLE IF NOT EXISTS offices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      office_id TEXT REFERENCES offices(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      patient_first_name TEXT NOT NULL,
      patient_last_name TEXT NOT NULL,
      tray_number TEXT,
      phone TEXT,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'job_created',
      order_destination TEXT NOT NULL,
      office_id TEXT NOT NULL REFERENCES offices(id),
      created_by TEXT REFERENCES users(id),
      status_changed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      custom_column_values TEXT NOT NULL DEFAULT '{}',
      is_redo_job INTEGER NOT NULL DEFAULT 0,
      original_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS archived_jobs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      patient_first_name TEXT NOT NULL,
      patient_last_name TEXT NOT NULL,
      tray_number TEXT,
      phone TEXT,
      job_type TEXT NOT NULL,
      final_status TEXT NOT NULL,
      previous_status TEXT,
      order_destination TEXT NOT NULL,
      office_id TEXT NOT NULL REFERENCES offices(id),
      created_by TEXT REFERENCES users(id),
      original_created_at INTEGER NOT NULL,
      archived_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      custom_column_values TEXT NOT NULL DEFAULT '{}',
      is_redo_job INTEGER NOT NULL DEFAULT 0,
      original_job_id TEXT,
      notes TEXT
    );`,

    `CREATE TABLE IF NOT EXISTS join_requests (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL REFERENCES users(id),
      office_id TEXT NOT NULL REFERENCES offices(id),
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS account_signup_requests (
      id TEXT PRIMARY KEY,
      office_id TEXT NOT NULL REFERENCES offices(id),
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      requested_role TEXT NOT NULL DEFAULT 'staff',
      status TEXT NOT NULL DEFAULT 'pending',
      request_message TEXT,
      requested_by_ip TEXT,
      user_agent TEXT,
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE INDEX IF NOT EXISTS account_signup_requests_office_status_created_idx
      ON account_signup_requests (office_id, status, created_at);`,
    `CREATE INDEX IF NOT EXISTS account_signup_requests_office_email_status_idx
      ON account_signup_requests (office_id, email, status);`,

    `CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      office_id TEXT NOT NULL REFERENCES offices(id),
      invited_by TEXT NOT NULL REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS job_comments (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      is_overdue_comment INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS comment_reads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      last_read_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(user_id, job_id)
    );`,

    `CREATE TABLE IF NOT EXISTS job_flags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      summary TEXT,
      summary_generated_at INTEGER,
      important_note TEXT,
      important_note_updated_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(user_id, job_id)
    );`,

    `CREATE TABLE IF NOT EXISTS job_status_history (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      old_status TEXT,
      new_status TEXT NOT NULL,
      changed_by TEXT NOT NULL REFERENCES users(id),
      changed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS notification_rules (
      id TEXT PRIMARY KEY,
      office_id TEXT NOT NULL REFERENCES offices(id),
      status TEXT NOT NULL,
      max_days INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sms_enabled INTEGER NOT NULL DEFAULT 0,
      sms_template TEXT,
      notify_roles TEXT NOT NULL DEFAULT '[]',
      notify_users TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      actor_id TEXT REFERENCES users(id),
      type TEXT NOT NULL,
      job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      link_to TEXT,
      read_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE INDEX IF NOT EXISTS notifications_user_id_read_at_idx ON notifications (user_id, read_at);`,

    `CREATE TABLE IF NOT EXISTS sms_opt_ins (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      office_id TEXT NOT NULL REFERENCES offices(id),
      ip_address TEXT,
      user_agent TEXT,
      source_url TEXT,
      consented_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS sms_logs (
      id TEXT PRIMARY KEY,
      job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      message_sid TEXT,
      error_code TEXT,
      error_message TEXT,
      sent_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS job_analytics (
      id TEXT PRIMARY KEY,
      office_id TEXT NOT NULL REFERENCES offices(id),
      date INTEGER NOT NULL,
      total_jobs_created INTEGER NOT NULL DEFAULT 0,
      jobs_by_status TEXT NOT NULL DEFAULT '{}',
      jobs_by_type TEXT NOT NULL DEFAULT '{}',
      avg_completion_time INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS platform_analytics (
      id TEXT PRIMARY KEY,
      date INTEGER NOT NULL,
      total_offices INTEGER NOT NULL DEFAULT 0,
      active_offices INTEGER NOT NULL DEFAULT 0,
      total_users INTEGER NOT NULL DEFAULT 0,
      total_jobs_created INTEGER NOT NULL DEFAULT 0,
      jobs_by_status TEXT NOT NULL DEFAULT '{}',
      jobs_by_type TEXT NOT NULL DEFAULT '{}',
      avg_completion_time INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,

    `CREATE TABLE IF NOT EXISTS phi_access_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      office_id TEXT REFERENCES offices(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      order_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      details TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );`,
  ];

  sqlite.transaction(() => {
    for (const statement of statements) {
      sqlite.prepare(statement).run();
    }

    // Migrations / forward-compat changes for existing installs.
    ensurePatientFirstName("jobs");
    ensurePatientFirstName("archived_jobs");
    ensureJobFlagNoteColumns();
    ensureHighContrastOfficeColors();
  })();
}
