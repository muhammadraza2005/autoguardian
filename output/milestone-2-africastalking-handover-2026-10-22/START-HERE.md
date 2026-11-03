# Milestone 2 installation handover — 22 October 2026

Start with docs/MILESTONE2-AFRICAS-TALKING-HANDOVER.md.

1. Run supabase/preflight-milestone2-telecom.sql and check hosted migration history.
2. On the inspected project, 024/025 are already present. Apply only missing SQL:
   026 billing operations -> 027 Africa's Talking SMS -> 028 channels -> 029 owner PIN.
3. Run the supplied verifiers using a schema-owner connection, not the runtime login.
4. Configure provider resources, trusted ingress, Supabase hook and approved PIN policy.
5. Accept actual simulator/handset journeys before production release.

This is an installation/documentation kit for the current AutoGuardian workspace,
not a standalone source-code deployment. Repository links in the guides refer to
that workspace. Existing source, earlier migrations and provider access are dependencies.

No real .env, API keys, signing/encryption secrets or phone lists are included.
See output/telecom-validation.json and output/telecom-hosted-inventory.json for
validation and read-only hosted findings. SHA256SUMS.json lists input digests.
