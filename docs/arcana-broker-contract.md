# Arcana broker contract questions

This document records questions for the Arcana project. Realm step 2 uses a deterministic fake broker and does not call Arcana or require credentials.

1. What production endpoint and authentication or service-binding model should Realm use?
2. What exact authorization and proxy protocol supports streaming Git and package traffic?
3. How are host, path, method, redirect, DNS, port, and CONNECT policies expressed and enforced?
4. What are lease TTL, rotation, revocation, replay-protection, rate-limit, and failure semantics?
5. What audit event schema, retention, export, and correlation identifiers are required?
6. How are user, sandbox, reference, and request identities bound end-to-end?
7. What deterministic test broker or conformance fixtures will Arcana provide?
8. How must Realm fail closed when authorization, proxying, or audit delivery is unavailable?

Secrets must be added only inside Arcana. Realm receives decisions and proxied responses, never credential values or broker storage access.
