# Silver-set check: is each statement supported by its source? (for a person to sign off)

`eval/fixtures/public-silver.draft.json` holds 68 one-line statements from 7 sources. On 2026-10-28 each one was
checked against its source for two things: does the source raise this **theme**, and does the **area label** match
where the source organization put it (the statement's `labelBasis`). The file was not changed: it stays `DRAFT`
with an empty `reviewedBy` until a person reads this, fixes or deletes rows, and signs (eval/README.md).

- **Theme:** `supported`, `partly` (the source raises it, but the statement adds or changes something; a fix is
  suggested) or `not found`.
- **Label:** `matches`, or what the source actually shows.
- **Inferred:** many `area-section` statements turn an action ("we made X easier") back into the barrier behind it
  ("X is hard"). Those are marked *inferred*: a fair reading, but the source never states the barrier itself.
- Locations and reasons are in our own words; nothing is quoted from the sources.

## Summary

| Source | Statements | Theme supported | Partly | Not found | Label issue |
|---|---|---|---|---|---|
| hc-2024 | 18 | 16 | 2 (PS007, PS012) | 0 | 0 |
| vac-2025 | 5 | 5 | 0 | 0 | 0 |
| scotia-2025 | 10 | 10 | 0 | 0 | 0 (PS027 worth a look) |
| pcf-2025 | 6 | 6 | 0 | 0 | 0 |
| rogers-2024 | 7 | 7 | 0 | 0 | 0 |
| ac-2025 | 19 | 16 | 3 (PS050, PS058, PS065) | 0 | 1 (PS058) |
| at-2025 | 3 | 3 | 0 | 0 | 0 |
| **Total** | **68** | **63** | **5** | **0** | **1** |

Every source loaded. Suggested edits: reword PS007, PS012, PS050 and PS065; fix PS058's `section` (and decide its
label); consider PS027's label.

## Statements that need a decision

| Id | Theme | Label | What the source shows | Suggested fix |
|---|---|---|---|---|
| PS007 | partly | matches | HC lists the reliability of motion doors *compared with* push-button doors as a theme, without saying which works better | "Motion-sensor doors are less reliable than doors you open with a button." only if you accept that reading; otherwise "The motion-sensor doors don't always open when I need them." |
| PS012 | partly | matches | HC's theme is digital application and web accessibility in general; assistive technology is our addition | "Some apps and web pages are not accessible." |
| PS050 | partly | matches | AC commits to making preboarding processes and transfer methods more efficient and available; "not reliable" and "at some airports" are ours | "Preboarding takes too long, and the equipment to help me board isn't always there." |
| PS058 | partly | **AC puts it under Design and Delivery of Programs and Services ("Near term – Employees"), not Employment** | A pilot to streamline accommodation requests and a planned company-wide request form; the inconsistency between departments is inferred | Change `section` to "Design and Delivery of Programs and Services > Near term – Employees". Keep `employment` (what the ACA area means) with labelBasis `org-category-mapped`, or relabel to `programs_services` to follow AC's placement |
| PS065 | partly | matches | AC is reviewing accessibility signage and icons for consistent, respectful, customer-focused language; it doesn't say they are hard to understand | "The signs and icons about accessibility are not consistent from one place to the next." |
| PS027 | supported | matches (debatable) | Scotiabank puts waiting for help in a branch under its branch theme, linked to Priority area 2 (built environment) | The label follows the source, as labelBasis says. As a reporter's sentence it reads as a service problem; keep it, or drop it from the set so the label isn't contested |

## Every statement

### hc-2024 · Health Canada 2024 (PDF): "What We Heard" (pp. 19–24) and "The Built Environment" (p. 7)

| Id | Area | Theme | Label | Where |
|---|---|---|---|---|
| PS001 | employment | supported | matches | What We Heard > Employment: limited career advancement |
| PS002 | employment | supported | matches | same list: hiring processes for people with an invisible disability |
| PS003 | employment | supported | matches | same list: no information on how return to office and hybrid work affect accessibility |
| PS004 | built_environment | supported | matches | Built environment list: inaccessible facilities |
| PS005 | built_environment | supported | matches | same list: getting to parking facilities |
| PS006 | built_environment | supported | matches | same list: not enough accessible parking near work |
| PS007 | built_environment | **partly** | matches | same list: motion doors compared with push doors (see above) |
| PS008 | built_environment | supported | matches | same list: availability of adaptive equipment |
| PS009 | built_environment | supported | matches | The Built Environment, second commitment: portal feedback about locker availability |
| PS010 | built_environment | supported | matches | same paragraph: secure doors needing automatic buttons and card readers |
| PS011 | ict | supported | matches | ICT list: inaccessible IT services |
| PS012 | ict | **partly** | matches | ICT list: digital application and web accessibility (see above) |
| PS013 | ict | supported | matches | ICT actions: the chat tool's read-aloud was only available after writing a message |
| PS014 | ict | supported | matches | ICT list: dark mode |
| PS015 | ict | supported | matches | ICT list: web pages and applications not accessible ("internal" is a reasonable reading, as most submissions came from employees) |
| PS016 | communication_other | supported | matches | Communication list: inaccessible documents and PDFs |
| PS017 | communication_other | supported | matches | Communication list: no captions on the internal TV screens |
| PS018 | procurement | supported | matches | Procurement: opportunities for businesses owned or led by people with disabilities |

### vac-2025 · Veterans Affairs Canada action plan, 5.0 Feedback (web page)

| Id | Area | Theme | Label | Where |
|---|---|---|---|---|
| PS019 | built_environment | supported | matches | Built environment theme: more sensory-friendly spaces that adapt to different needs |
| PS020 | built_environment | supported | matches | same paragraph: doors and workspaces in some locations |
| PS021 | ict | supported | matches | ICT themes: inaccessible emails from different parts of the department |
| PS022 | ict | supported | matches | same list: navigating client systems such as the online account |
| PS023 | ict | supported | matches | same list: better promote and explain existing accessibility technologies |

### scotia-2025 · Scotiabank 2025 (PDF): "Feedback" (pp. 7–8) and Priority area 6

| Id | Area | Theme | Label | Where |
|---|---|---|---|---|
| PS024 | programs_services | supported | matches | Client Theme 1 (links to area 6): personalized and remote banking for clients with mobility limits |
| PS025 | programs_services | supported | matches | Client Theme 1: employee training to support clients with disabilities |
| PS026 | built_environment | supported | matches | Client Theme 3 (links to area 2): more seating and accessible parking |
| PS027 | built_environment | supported | matches (debatable) | Client Theme 3: more timely help, shorter waits (see above) |
| PS028 | built_environment | supported | matches (mapped) | Employee Theme 1, physical spaces: limit fluorescent lighting |
| PS029 | built_environment | supported | matches (mapped) | Employee Theme 1: stronger enforcement of the scent-free policy |
| PS030 | ict | supported | matches (mapped) | Employee Theme 3, technology: leaders' awareness of accessible technology options |
| PS031 | ict | supported | matches (mapped) | Employee Theme 3: a more accessible onboarding to learn these technologies |
| PS032 | programs_services | supported, inferred | matches | Area 6, Commitment 2: piloting ASL and LSQ access at selected branches, based on feedback |
| PS033 | programs_services | supported, inferred | matches | Area 6, Commitment 1: simplified accessible-statement requests to make delivery timely |

"Mapped" = labelBasis `org-category-mapped`: the bank's own category (physical spaces, technology) mapped to the
ACA area. Both mappings look right.

### pcf-2025 · PC Financial 2025 (PDF): barrier tables in sections 2.1, 2.3 and 2.6

| Id | Area | Theme | Label | Where |
|---|---|---|---|---|
| PS034 | programs_services | supported | matches | 2.6 table: card and phone number print too small and not embossed, for low vision |
| PS035 | programs_services | supported | matches | 2.6 table: not enough time to key in the card number in the phone system (now fixed) |
| PS036 | programs_services | supported | matches | 2.6 table: navigating the phone menu buttons and reaching a live agent |
| PS037 | programs_services | supported | matches | 2.6 table: putting in a travel notice on the online portal |
| PS038 | ict | supported | matches | 2.3 table: joining video meetings from some office meeting rooms |
| PS039 | employment | supported | matches | 2.1 table: access to resources on accessibility requests, and leaders knowing how to support |

### rogers-2024 · Rogers 2024 (web page): Priority Areas 1, 3, 5 and 6

| Id | Area | Theme | Label | Where |
|---|---|---|---|---|
| PS040 | employment | supported, inferred | matches | Area 1: accommodation process streamlined for a consistent experience |
| PS041 | employment | supported, inferred | matches | Area 1: a support model for assistive-technology requests |
| PS042 | employment | supported, inferred | matches | Area 1: support to search and apply on the internal careers portal while its accessibility is investigated |
| PS043 | procurement | supported, inferred | matches | Area 5: supplier platform and training documents made more accessible |
| PS044 | programs_services | supported, inferred | matches | Area 6: discount eligibility made easier to understand (the Feedback section also names it) |
| PS045 | programs_services | supported, inferred | matches | Area 6: making it easier for retail staff to find accessibility information |
| PS046 | ict | supported, inferred | matches | Area 3: cafeteria payment terminals made accessible |

### ac-2025 · Air Canada 2025 (web page): the seven area sections

| Id | Area | Theme | Label | Where |
|---|---|---|---|---|
| PS047 | programs_services | supported, inferred | matches | Design and Delivery: assessed transfer equipment and found more choice was needed |
| PS048 | transportation | supported, inferred | matches | Transportation: safe cabin stowage for foldable manual wheelchairs |
| PS049 | transportation | supported, inferred | matches | Transportation: small cargo doors raised with manufacturers ("power wheelchair" is our example of a large aid) |
| PS050 | transportation | **partly** | matches | Transportation: efficiency and availability of preboarding and transfer methods (see above) |
| PS051 | transportation | supported, inferred | matches | Transportation: certification for service dogs, including owner-trained dogs |
| PS052 | transportation | supported, inferred | matches | Transportation: washroom designs for narrow-body aircraft |
| PS053 | transportation | supported, inferred | matches | Transportation: resolving damaged or delayed mobility aids |
| PS054 | built_environment | supported, inferred | matches | Built Environment: wayfinding and signage requested from airport authorities |
| PS055 | built_environment | supported, inferred | matches | Built Environment: sensory rooms and tailored spaces |
| PS056 | built_environment | supported, inferred | matches | Built Environment: elevator size and availability |
| PS057 | built_environment | supported, inferred | matches | Built Environment: bought more in-terminal wheelchairs and aisle chairs |
| PS058 | employment | **partly** | **section differs** | Design and Delivery, "Near term – Employees": streamlining accommodation requests (see above) |
| PS059 | employment | supported, inferred | matches | Employment: tools to onboard employees who disclosed a disability |
| PS060 | employment | supported, inferred | matches | Employment: accommodation requests before employment starts |
| PS061 | ict | supported, inferred | matches | ICT: website and app for assistive-technology users and neurodivergent customers |
| PS062 | ict | supported, inferred | matches | ICT: captions or sign language on gate screens (the airports run them) |
| PS063 | ict | supported, inferred | matches | ICT: independent access to the accessible in-flight entertainment mode |
| PS064 | ict | supported, inferred | matches | ICT: captions or sign language for on-board announcements |
| PS065 | communication_other | **partly** | matches | Communication: review of accessibility signage and icons (see above) |

### at-2025 · Air Transat progress report, year 2 (web page): sections 3.2, 6.1 and 6.2

| Id | Area | Theme | Label | Where |
|---|---|---|---|---|
| PS066 | programs_services | supported, inferred | matches | 6.1: customer feedback and service shortcomings led to new cabin-crew training |
| PS067 | programs_services | supported, inferred | matches | 6.2: lifted a weight limit for mobility aids on one aircraft type |
| PS068 | ict | supported, inferred | matches | 3.2: website and app accessibility fixes and a rising audit score |

## What a person still has to do

1. Decide on the six statements in "Statements that need a decision" and edit the draft file.
2. Spot-check a few "inferred" rows: whether the set accepts inferred barriers is a policy call, not a fact.
3. Then set `status` to `reviewed`, add your name to `reviewedBy` and rename the file (eval/README.md).
