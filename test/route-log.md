# Pharos route log

config: FLOOR=3 · SWITCH_MARGIN=2 · 44 prompts

| # | input | → routed | domain | margin | reason | nonzero scores |
|---|-------|----------|--------|--------|--------|----------------|
| 1 | fix the PreCompact hook so it writes the handoff before compaction | **ptah** | code | 3 | argmax | ptah:3 |
| 2 | refactor retrieval.cjs to seed the domain profiles from the memory index | **ptah** | code | 3 | argmax | ptah:3 |
| 3 | why is the docs MCP showing pending approval | **anubis** | general | 2 | below-floor->intake | ptah:2 |
| 4 | write the scoring function for the Pharos classifier | **ptah** | code | 5 | argmax | ptah:5 |
| 5 | the gitnexus index is stale, reindex the repo | **anubis** | general | 2 | below-floor->intake | ptah:2 |
| 6 | add a confidence margin to the classify output and debug the parser | **ptah** | code | 5 | argmax | ptah:5 |
| 7 | what's on my calendar this weekend | **ra** | personal | 5 | argmax | ra:5 |
| 8 | book the flight to Lisbon before the visa expires | **ra** | personal | 5 | argmax | ra:5 |
| 9 | remind me to call my family this weekend | **ra** | personal | 7 | argmax | ra:7 |
| 10 | did I journal about the hike last sunday | **ra** | personal | 3 | argmax | ra:3 |
| 11 | schedule a gym session friday morning | **ra** | personal | 5 | argmax | ra:5 |
| 12 | plan the second leg of the summer trip | **anubis** | general | 2 | below-floor->intake | ra:2 |
| 13 | help me start the discussion post for this week | **thoth** | classwork | 4 | argmax | thoth:4 |
| 14 | review my linear algebra pset before I submit it | **thoth** | classwork | 7 | argmax | thoth:7 |
| 15 | which courses should I take in the fall semester | **thoth** | classwork | 5 | argmax | thoth:5 |
| 16 | explain backprop for my deep learning notes | **thoth** | classwork | 8 | argmax | thoth:8 |
| 17 | do today's leetcode and log it in my study plan | **thoth** | classwork | 5 | argmax | thoth:5 |
| 18 | summarize the lecture on optimization | **thoth** | classwork | 5 | argmax | thoth:5 |
| 19 | prep questions for the Acme meeting | **anubis** | general | 0 | below-floor->intake | — |
| 20 | score my resume the way a recruiter would | **horus** | professional | 6 | argmax | horus:6 |
| 21 | draft a follow-up to the recruiter intro | **horus** | professional | 3 | argmax | horus:3 |
| 22 | what's a fair TC to counter the offer with | **horus** | professional | 8 | argmax | horus:8 |
| 23 | update my LinkedIn headline for recruiting | **horus** | professional | 6 | argmax | horus:6 |
| 24 | should I take the contract gig this week or focus on studying | **anubis** | general | 0 | below-floor->intake | — |
| 25 | tell me a joke | **anubis** | general | 0 | below-floor->intake | — |
| 26 | I just thought of a totally new side project, not sure what bucket | **anubis** | general | 0 | below-floor->intake | — |
| 27 | random question, how do octopuses actually think | **anubis** | general | 0 | below-floor->intake | — |
| 28 | what's the meaning of the name Alexandria anyway | **anubis** | general | 0 | below-floor->intake | — |
| 29 | counter at 150 | **anubis** | general | 2 | below-floor->intake | horus:2 |
| 30 | ship it | **anubis** | general | 0 | below-floor->intake | — |
| 31 | does it pass now | **anubis** | general | 0 | below-floor->intake | — |
| 32 | is 150 too low to push back on | **anubis** | general | 0 | below-floor->intake | — |
| 33 | they still haven't gotten back to me | **anubis** | general | 0 | below-floor->intake | — |
| 34 | the optimization isn't converging in my code | **anubis** | general | 0 | below-floor->intake | ptah:2 thoth:2 |
| 35 | my flight got delayed so reschedule the interview | **ra** | personal | 0 | argmax | ra:3 horus:3 |
| 36 | skip class to prep for the acme onsite | **thoth** | classwork | 1 | argmax | thoth:3 horus:2 |
| 37 | build a study schedule for the semester | **thoth** | classwork | 1 | argmax | thoth:4 ra:3 ptah:2 |
| 38 | fix that one | **anubis** | general | 0 | below-floor->intake | — |
| 39 | wrap the pset tonight | **thoth** | classwork | 3 | argmax | thoth:3 |
| 40 | lock in the lisbon dates | **anubis** | general | 0 | below-floor->intake | — |
| 41 | can you take a look at the hysteresis thing | **anubis** | general | 0 | below-floor->intake | — |
| 42 | how'd the mock go | **anubis** | general | 0 | below-floor->intake | — |
| 43 | remind me about the thing tomorrow | **ra** | personal | 3 | argmax | ra:3 |
| 44 | is this worth building or should I just drop it | **anubis** | general | 0 | below-floor->intake | — |
