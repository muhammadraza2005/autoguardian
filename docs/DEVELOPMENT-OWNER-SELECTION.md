# Development owner selection

Run [006](../supabase/migrations/202610060006_development_owner_selection.sql), then [development owner setup](../supabase/setup-development-owner.sql), once as `postgres` after 005 and the agent setup. Expected owner output: `Development owner 1`, `NOT_VERIFIED`, `active=true`. The user has confirmed this output in the hosted development project.

The app now loads organization-scoped synthetic owner choices from the backend, replacing the editable UUID. Selection is not verified ownership. Saves reject withdrawn/inactive/unlisted profiles; another organization's choices and raw private identity records are not exposed. Existing drafts are preserved. No Auth account, password, OWNER assignment or core ownership record is created by these files.

Restart the backend/live preview, open a draft, select Development owner 1, save and reopen it to verify selection persists. New drafts require explicit selection. Successful saves return to the draft list; failed saves retain the form. Private identity capture and phone OTP remain pending. See [sample file uploads](DEVELOPMENT-EVIDENCE-UPLOADS.md) for the next development setup.
