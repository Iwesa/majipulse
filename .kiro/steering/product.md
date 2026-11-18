# MajiPulse Product

MajiPulse is an offline-first, AI-assisted water infrastructure monitoring platform.

## Users and organizations
- Customers: community water organizations, NGOs, and water departments.
- Roles:
  - **Administrator**: manages the organization, users, water points, and maintenance oversight.
  - **Technician**: handles incidents and maintenance work.
  - **Reporter**: registers and reports incidents, often with poor connectivity.

## Core capabilities
1. Water-point registration
2. Incident reporting
3. AI-assisted incident extraction (assists the reporter; never replaces their input)
4. Offline reporting
5. Synchronization
6. Recurring-pattern analysis
7. Maintenance management

## MVP scope
- Responsive web application (mobile-first for field use, usable on desktop).
- Build only what the current task asks for. Do not add features outside the list above.

## Demo data
- Use fictional Kwale County data only.
- Label demo data clearly as fictional in the UI and in seed files (for example `demo: true` and a visible "Demo data" badge).
- Never present demo data as real incidents, real water points, or real people.

## Product principles
- Reporting must always work without AI, and without network once the app has loaded (no offline cold start in the MVP).
- Users stay in control: AI output is a suggestion the user confirms or edits.
- Show real state: sync status, AI source, and errors must be accurate.
