# Pharos route log

config: FLOOR=3 · SWITCH_MARGIN=2 · 44 prompts

| # | input | → routed | domain | margin | reason | nonzero scores |
|---|-------|----------|--------|--------|--------|----------------|
| 1 | fix the PreCompact hook so it writes the handoff before compaction | **ptah** | code | 3 | argmax | ptah:3 |
| 2 | refactor retrieval.cjs to seed the domain profiles from the ark index | **ptah** | code | 3 | argmax | ptah:3 |
| 3 | why is the devnexus MCP showing pending approval | **anubis** | intake | 2 | below-floor->intake | ptah:2 |
| 4 | write the scoring function for the Pharos classifier | **ptah** | code | 5 | argmax | ptah:5 |
| 5 | the gitnexus index is stale, reindex the repo | **anubis** | intake | 2 | below-floor->intake | ptah:2 |
| 6 | add a confidence margin to the classify output and debug the parser | **ptah** | code | 5 | argmax | ptah:5 |
| 7 | what's on my calendar this weekend | **ra** | personal | 5 | argmax | ra:5 |
| 8 | book the flight to Sri Lanka before the ETA expires | **ra** | personal | 3 | argmax | ra:3 |
| 9 | remind me to call my family in Taiwan | **ra** | personal | 5 | argmax | ra:5 |
| 10 | did I journal about church last sunday | **ra** | personal | 6 | argmax | ra:6 |
| 11 | schedule a taekwondo session friday morning | **ra** | personal | 3 | argmax | ra:3 |
| 12 | plan the Malaysia leg of the summer trip | **anubis** | intake | 2 | below-floor->intake | ra:2 |
| 13 | help me start the discussion post for this week | **thoth** | classwork | 4 | argmax | thoth:4 |
| 14 | review my linear algebra pset before I submit it | **thoth** | classwork | 7 | argmax | thoth:7 |
| 15 | which Cornell courses should I take in the fall semester | **thoth** | classwork | 5 | argmax | thoth:5 |
| 16 | explain backprop for my deep learning notes | **thoth** | classwork | 8 | argmax | thoth:8 |
| 17 | do today's leetcode and log it in the curriculum | **thoth** | classwork | 6 | argmax | thoth:6 |
| 18 | summarize the lecture on optimization | **thoth** | classwork | 5 | argmax | thoth:5 |
| 19 | prep questions for the Juniper meeting | **anubis** | intake | 0 | below-floor->intake | — |
| 20 | score my resume the way a recruiter would | **horus** | career | 6 | argmax | horus:6 |
| 21 | draft a follow-up to the Planisphere intro | **anubis** | intake | 0 | below-floor->intake | — |
| 22 | what's a fair TC to counter the offer with | **horus** | career | 8 | argmax | horus:8 |
| 23 | update my LinkedIn headline for recruiting | **horus** | career | 6 | argmax | horus:6 |
| 24 | should I take the Mercor gig this week or focus on the curriculum | **thoth** | classwork | 3 | argmax | thoth:3 |
| 25 | tell me a joke | **anubis** | intake | 0 | below-floor->intake | — |
| 26 | I just thought of a totally new side project, not sure what bucket | **anubis** | intake | 0 | below-floor->intake | — |
| 27 | random question, how do octopuses actually think | **anubis** | intake | 0 | below-floor->intake | — |
| 28 | what's the meaning of the name Alexandria anyway | **anubis** | intake | 0 | below-floor->intake | — |
| 29 | counter at 320 | **anubis** | intake | 2 | below-floor->intake | horus:2 |
| 30 | ship it | **anubis** | intake | 0 | below-floor->intake | — |
| 31 | does it pass now | **anubis** | intake | 0 | below-floor->intake | — |
| 32 | is 320 too low to push back on | **anubis** | intake | 0 | below-floor->intake | — |
| 33 | they still haven't gotten back to me | **anubis** | intake | 0 | below-floor->intake | — |
| 34 | the optimization isn't converging in my code | **anubis** | intake | 0 | below-floor->intake | ptah:2 thoth:2 |
| 35 | my flight got delayed so reschedule the interview | **ra** | personal | 0 | argmax | ra:3 horus:3 |
| 36 | skip class to prep for the juniper onsite | **thoth** | classwork | 1 | argmax | thoth:3 horus:2 |
| 37 | build a study schedule for the curriculum | **thoth** | classwork | 2 | argmax | thoth:5 ra:3 ptah:1 |
| 38 | fix that one | **anubis** | intake | 0 | below-floor->intake | — |
| 39 | wrap the pset tonight | **thoth** | classwork | 3 | argmax | thoth:3 |
| 40 | lock in the sri lanka dates | **anubis** | intake | 0 | below-floor->intake | — |
| 41 | can you take a look at the hysteresis thing | **anubis** | intake | 0 | below-floor->intake | — |
| 42 | how'd the mock go | **anubis** | intake | 0 | below-floor->intake | — |
| 43 | remind me about the thing tomorrow | **ra** | personal | 3 | argmax | ra:3 |
| 44 | is this worth building or should I just drop it | **anubis** | intake | 0 | below-floor->intake | — |
