# Repository instructions

- Use only this repository's `.memory/project.mv2` for Memvid context. Search relevant prior decisions and verify against current files. Save durable changes after meaningful development; never store secrets, customer data, logs, or build output.
- Keep the Traditional Chinese UI concise; avoid unnecessary secondary labels.
- This is an Office.js compose add-in targeting Windows new Outlook, Mac Outlook, and Outlook on the web with one XML manifest and shared HTTPS taskpane. Operate only on the current draft. Never send mail or add Graph authentication. Company identity uses an Entra scope for this project's own template API only.
- Keep centrally published templates separate from personal localStorage settings. Revalidate publication before insertion, enforce read/edit/publish and audience authorization on the server, and never upload filled variables or current drafts to the template API.
- Preserve signatures, existing content, and reply history. If the managed template cannot be located safely, fail closed instead of inserting another template or replacing arbitrary content.
- Distinguish automated mock verification from real Outlook validation.
