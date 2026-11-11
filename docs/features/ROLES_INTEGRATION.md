# Team roles (Setter, Closer, ...): how every module uses them

The CRM has no setter or closer title, so the agency gives each team member a **role label** in Team > Roles (Setter, Closer, Both, Support, Manager, Other). It is kept only in SubSync (tables `team_member_roles`, `team_member_role_history`, flag `pp_roles`). Nothing is written to the CRM.

A label can be set for **everywhere** (the default, `location_id = ''`) or for **one account** (overrides the default there). Only agency owners and administrators set labels for everywhere; an account administrator sets labels for their own account only; everyone else reads.

## Calling it (browser)

```tsx
import { RoleChip, useApptRoleWords, useRoles } from "@/app/app/roles";   // or "../../roles" from a view

const roles = useRoles();                       // one shared read of GET people3/roles/map (60 s)
roles.roleOf(userId, locationId?)               // "setter" | "closer" | "both" | "support" | "manager" | "other" | null
roles.label(userId, locationId?)                // "Setter" | ... | null
roles.has(userId, "setters", locationId?)       // filter: "setters" and "closers" include people who are "both"; "none" = no role set
roles.any                                       // true once anyone is a setter, closer or both

<RoleChip userId={id} locationId={loc} />       // the small label beside a name (draws nothing when none)
```

When the flag is off, or the caller may not see the person, the hook simply returns null: nothing breaks, nothing is drawn.

## Appointments (ap3): what to wire

1. **Wording.** Replace the hard-coded "Booked by" / "Assigned to" column and line labels with:
   ```tsx
   const { bookedBy, takenBy, tip } = useApptRoleWords();
   // <th title={tip}>{bookedBy}</th> ... <th title={tip}>{takenBy}</th>
   ```
   Until someone has a Setter or Closer label this returns "Booked by" / "Assigned to"; afterwards "Setter" / "Closer". `tip` is the one-line explanation: "Setter: books the appointment. Closer: takes the appointment and closes the deal."
2. **Chips.** After every person's name (booking share, flow tree, compare, leaderboard rows, appointment panel owner): `<RoleChip userId={row.bookedById} locationId={row.locationId} />`. The ids are the CRM user ids the rows already carry.
3. **Role-based boards.** Where a board is "setters" or "closers" today (derived from activity), filter by label instead and say so: `rows.filter((r) => roles.has(r.userId, "setters", r.locationId))`. Keep the activity-based rule as the fallback when `roles.any` is false, so a screen is never empty only because no role is set yet.
4. **Server side (optional).** For a role-aware query, use the new, separate file `src/lib/analytics/team-roles-queries.ts` (`roleMap(scope, ids)` returns every label the caller may see) or join in SQL:
   ```sql
   left join team_member_roles r_loc on r_loc.installation_id = a.installation_id and r_loc.user_id = a.user_id and r_loc.location_id = a.location_id
   left join team_member_roles r_all on r_all.installation_id = a.installation_id and r_all.user_id = a.user_id and r_all.location_id = ''
   -- the role in that account: coalesce(r_loc.role, r_all.role)
   ```
   Always keep `installation_id` in the join. Do not edit `team_member_roles` from another module: changes go through `POST people3/roles/set` (preview, then do) so they are audited and can be undone.

## Pure helpers (also usable on the server): `src/lib/people/roles.ts`

`resolveRole`, `matchesRole`, `roleWord`, `hasSetterCloser`, `bookedByLabel`, `takenByLabel`, `suggestRole`, `ROLE_LABEL`, `ROLE_TIP`, `SETTER_CLOSER_TIP`.

## Already wired

Team (every list, the person panel with an inline picker, and the Roles tab), Today > People, Clients > People, Pipeline owner (deal list and panel), Speed to lead (people lists and routing notes), Unanswered owner column.

## Not wired yet (small follow-ups)

Team leaderboard and scorecard "role" filters still use activity ("answers leads" = setter, "takes appointments" = closer); switch them to labels once `roles.any` is true. Exports and receipts can add a "Role" column from `roleMap`.

## Rules kept

Estimates (the suggested role) are labelled as estimates and show their evidence; they are never applied by themselves. Clearing a role needs the person's name (or "clear N roles") typed. Every change writes an append-only history row and an audit line, and can be undone from Team > Roles > recent changes.
