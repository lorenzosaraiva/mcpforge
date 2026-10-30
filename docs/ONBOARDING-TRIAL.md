# MCPForge 2.0 onboarding trial

Status: not started. No external participant results have been collected. This is a release gate, not an automated-test substitute.

Recruit five consenting users independently of the implementation. Include Windows and macOS/Linux users and cover Cursor, Claude Desktop, and VS Code. Give each person the candidate build, one pinned task-pack specification, a suitable test account where needed, and the setup guide. Do not collect API keys or full environment/client files.

Start timing after account creation and credential issuance. Ask the participant to connect the API, enable/reload tools in the client, complete one read-only task, use `doctor` to explain the verification level, and disconnect. Record intervention, whether client JSON was edited, and any confusing or failed step. Inspect diagnostic reports for secrets before sharing them.

| Participant | OS / Node / client versions | API/task | Time to first successful task | Manual JSON edits | Maintainer intervention | Result / blocker |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pending | Pending | Not measured | Not measured | Not measured | Pending |
| 2 | Pending | Pending | Not measured | Not measured | Not measured | Pending |
| 3 | Pending | Pending | Not measured | Not measured | Not measured | Pending |
| 4 | Pending | Pending | Not measured | Not measured | Not measured | Pending |
| 5 | Pending | Pending | Not measured | Not measured | Not measured | Pending |

Pass criteria: at least four of five users complete a first task without editing client JSON, and the measured median setup time is below five minutes, excluding accounts/credential issuance. Open reproducible issues for blockers. Keep participant identities private, distinguish observed client loading from configuration-file checks, and obtain consent before publishing anonymized findings.
