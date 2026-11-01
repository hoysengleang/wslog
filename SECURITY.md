# Security policy

wslog sees everything that passes through it, often including tokens and personal data, so security reports get priority.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub instead: [Report a vulnerability](https://github.com/hoysengleang/wslog/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could do with it. Do not include real tokens or traffic from production systems.

You will get a reply within 7 days. Once a fix is released, the advisory is published and you are credited unless you prefer not to be.

## Scope

In scope: anything that lets another website, another user on the machine, or another host on the network read traffic, change settings, or reach the dashboard without the right token, and any case where a masked value reaches storage, the dashboard, logs, or an export.

Out of scope: running wslog on a public network against the README's advice (`--host 0.0.0.0` with no firewall), and anything that requires the admin token.
