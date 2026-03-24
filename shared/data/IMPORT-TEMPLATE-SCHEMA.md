# Import Template Schema

Built-in import templates are stored in `built-in-import-templates.json` as a JSON array.
Each entry must conform to the `ImportTemplate` type defined in `shared/import-types.ts`.

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Stable identifier, e.g. `"crystalpm-frames"` |
| `name` | string | yes | Display name, e.g. `"CrystalPM - Frames"` |
| `ehrSystem` | string | no | EHR system label for UI grouping, e.g. `"CrystalPM"` |
| `type` | `"built-in"` | yes | Must be `"built-in"` for entries in this file |
| `jobType` | string | yes | One of: `"glasses"`, `"contacts"`, `"sunglasses"`, `"prescription"` |
| `fieldMappings` | object | yes | Maps CSV column names to Otto field names (or `null` to skip) |
| `statusMappings` | object | yes | Maps CSV status values to Otto status IDs (or `null` to skip rows) |

## Otto field names for `fieldMappings`

- `"firstName"` — Patient first name
- `"lastName"` — Patient last name
- `"patientNameCombined"` — Combined name, split as "Last, First" or "First Last"
- `"status"` — Job status (values go through `statusMappings`)
- `"destination"` — Lab or vendor name
- `"createdDate"` — Job creation date
- `"updatedDate"` — Last updated date

## Example entry

```json
{
  "id": "crystalpm-frames",
  "name": "CrystalPM - Frames",
  "ehrSystem": "CrystalPM",
  "type": "built-in",
  "jobType": "glasses",
  "fieldMappings": {
    "Patient": "patientNameCombined",
    "Date": "createdDate",
    "Status": "status",
    "Lab/Vendor": "destination",
    "Expected": null,
    "Dispensed": null,
    "Optician": null,
    "Frame UPC": null,
    "F Man.": null,
    "F Series": null,
    "F Name": null,
    "F Color": null
  },
  "statusMappings": {
    "Created": "job_created",
    "On Hold": "in_progress",
    "Dispensed": "completed",
    "Mailed": "completed",
    "Cancelled": "cancelled",
    "Patient Called": null,
    "Patient Texted": null,
    "Did Not Pick-Up": null,
    "Returned": null
  }
}
```

To add a new built-in template, add a valid JSON object to the array in
`built-in-import-templates.json`. The app will load it on next startup.
