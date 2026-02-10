export type MessageTemplateVariables = Record<string, string | number | null | undefined>;

export function renderMessageTemplate(template: string, variables: MessageTemplateVariables): string {
  if (!template) return "";

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const value = variables[key];
    if (value === null || value === undefined) return match;
    return String(value);
  });
}

