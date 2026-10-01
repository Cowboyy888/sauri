# Campaigns (Phase 7)

`lib/marketing/campaigns.ts`, `/admin/marketing/campaigns`. See docs/ATTRIBUTION.md for how orders/events get
matched to a campaign, and docs/MARKETING_ANALYTICS.md for the numbers reported per campaign.

## A campaign's ID *is* its `utm_campaign` value

The brief lists "Campaign Name" and "Campaign ID" as separate fields (§6), and separately asks that
`utm_campaign` identify a campaign (§4, §51's `SUMMER2026` example). Rather than invent two identifiers that
have to be kept in sync, `marketing_campaigns.slug` **is** the exact string used for both: what the admin
types as the campaign's ID is exactly what gets matched, case-insensitively, against `utm_campaign` on every
event, order and email send. `name` is the separate human-readable label ("Summer Sale") shown throughout
the admin. Slugs are normalized to uppercase and restricted to `[A-Z0-9_-]` on creation.

## Fields (brief §6)

Name, Campaign ID (`slug`, unique), Source, Medium (free text — not the fixed `acquisition_source` enum,
since a campaign can target any platform, including ones without a dedicated enum value), Start/End Date,
Budget (planned spend, a single optional number), Status, Description.

## Status (brief §42)

```
DRAFT → ACTIVE → PAUSED → ACTIVE (resume)
              ↘ COMPLETED
DRAFT/ACTIVE/PAUSED/COMPLETED → ARCHIVED
```

Enforced server-side (`setCampaignStatus`, `CAMPAIGN_TRANSITIONS`) — an invalid transition (e.g. `COMPLETED`
back to `ACTIVE`) is rejected with a clear error, not silently allowed.

## Spend (brief §28)

Actual spend is **not** a single mutable column — it's the sum of `campaign_costs`, one or more dated,
manually-entered rows (`logCampaignCost`). This is both more auditable (each entry has its own date, note
and author, and appears in the audit log) and matches the brief's own table list (§45: `campaign_costs`
alongside `marketing_campaigns`). `getCampaignActualSpendCents()` sums them on read. When nothing has been
logged, spend is `0`, and every dependent metric (ROAS, ROI, CAC) reports `N/A` rather than treating that `0`
as "spent nothing and broke even" — see docs/MARKETING_ANALYTICS.md.

## URL builder (brief §7)

`buildCampaignUrl()` — a pure function, no side effects. Takes a destination URL plus source/medium/campaign/
term/content and appends `utm_*` params without disturbing an existing query string or fragment. Throws
(rather than returning a malformed string) if the destination isn't a valid URL or a required field is
missing. The admin UI (`/admin/marketing/campaigns`) offers a picker of existing campaigns so the generated
URL's `utm_campaign` always matches a real, trackable campaign, and a one-click copy button.

## RBAC (brief §44)

`marketing:read`/`marketing:write` — a new permission area, separate from the pre-existing OWNER-only
`discounts` area (docs/ROLES_AND_PERMISSIONS.md). OWNER and ADMIN can create and manage campaigns; SALES and
VIEWER get read-only access; INVENTORY has none (unrelated to its area, matching how it already has no
`customers`/`sales` access).

## Audit logging (brief §43)

Every campaign create/edit/status-change and every cost entry writes an `audit_logs` row via the existing
`audit()` helper — no new logging mechanism.
