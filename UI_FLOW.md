# PolicySync — UI Flow Reference

## The Problem
Navigation labels: Monitoring | Review queue | ISearch | Policy changes (role-filtered).
Access is enforced by middleware redirect — but visually all roles see the same nav.
Fix: hide nav links based on role.

---

## Roles & Access

| Route | Admin | Reviewer | Viewer |
|-------|-------|----------|--------|
| `/` Home | ✅ | ✅ | ✅ |
| `/admin` | ✅ | ❌ | ❌ |
| `/review` | ✅ | ✅ | ❌ |
| `/search` | ✅ | ✅ | ✅ |
| `/changelog` | ✅ | ✅ | ✅ |

---

## Admin Flow

```
Login → Home (/)
         ├── /admin         Payer monitoring dashboard
         │     • Toggle payers on/off
         │     • "Fetch Now" triggers pipeline
         │     • Table: payer, status, last fetched, policy count
         │
         ├── /review        AI extraction review queue
         │     • Drafts table with eval score badge (0–100)
         │     • Approve → publishes rule
         │     • Reject → modal with reason
         │
         ├── /search        Semantic drug policy search
         │     • Search bar + cross-payer comparison table
         │
         └── /changelog     Policy change feed
               • Clinical changes (amber ⚠️)
               • Cosmetic changes (blue ℹ️)
```

---

## Reviewer Flow

```
Login → Home (/)
         ├── /review        AI extraction review queue
         ├── /search
         └── /changelog
         [/admin → redirected to /]
```

---

## Viewer Flow

```
Login → Home (/)
         ├── /search
         └── /changelog
         [/admin, /review → redirected to /]
```

---

## Screen-by-Screen Breakdown

### 1. Login
- Auth0 login button
- Product name + tagline

### 2. Home `/`
- Stats strip: # published rules, # payers monitored
- Search page sub-tabs: Q&A | Compare | Recent updates (`/search?tab=…`)
- Recent changes strip (clinical vs cosmetic)
- Role quick-links grid (show only links the user can access)

### 3. Admin `/admin`
- Table columns: Payer Name | Format | Status | Last Fetched | Last Changed | Policy Count
- Toggle switch per row (active/inactive)
- "Fetch Now" button per row
- Status badge: active (green) / inactive (grey)

### 4. Review `/review`
- Filter tabs: Pending Review | Eval Failed
- Per draft card:
  - Drug name + payer
  - Eval score badge (0–100, green ≥80 / amber 60–79 / red <60)
  - RAGAS metrics
  - Citation snippets
  - Approve button (green) | Reject button (red)
- Reject → modal: text field for rejection reason + confirm

### 5. Search `/search`
- Search bar (semantic, e.g. "bevacizumab prior auth")
- Mode toggle: Search | Compare
- Search results card:
  - Drug name + brand
  - Payer name
  - Coverage tier badge (preferred / non_preferred / not_covered)
  - Prior auth required (yes/no badge)
  - Indications covered (list)
- Compare mode: side-by-side table across payers for one drug

### 6. Changelog `/changelog`
- Timeline feed, newest first
- Each entry:
  - Date + payer name
  - Change type tag: Clinical ⚠️ (amber) | Cosmetic ℹ️ (blue)
  - Drug name
  - Diff view: old value → new value

---

## Nav Variants to Design in Stitch

### Admin Nav
`Monitoring` | `Review queue` | `ISearch` | `Policy changes` | Sign Out

### Reviewer Nav
`Review queue` | `ISearch` | `Policy changes` | Sign Out

### Viewer Nav
`ISearch` | `Policy changes` | Sign Out

---

## Role Hierarchy
```
viewer (1) < reviewer (2) < admin (3)
```
Admins can access everything reviewers and viewers can.
Reviewers can access everything viewers can.
Roles come from Auth0 JWT claim: `https://policysync.app/roles`
