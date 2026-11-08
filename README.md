# sciapp

Accessible conversational care companion for people with spinal cord injuries.

## Status

Project initialized. The first milestone is a mobile-friendly web proof of concept. Application implementation and deployment are not complete.

## Product direction

One conversation supports typing, voice, photos, and large suggested-answer buttons. All settings and caregiver invitations must be manageable through the same interface. Users can move between input modes without losing task context.

Web and Android will share a Cloudflare backend. A future WhatsApp adapter will use the same authorized care actions.

- [Product requirements](docs/product-requirements.md)
- [Architecture](docs/architecture.md)
- [POC acceptance criteria](docs/poc-acceptance.md)

## Development boundaries

Use synthetic fixtures during initial development. Never commit credentials, personal medical data, recordings, private documents, or the reference WhatsApp PDF. Public repository visibility does not grant an open-source license; a license has not yet been selected.
