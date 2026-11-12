import type { IsoEntry } from "./iso.js";

// Clauses 4 to 10 first, then Annex A, in the standard's own order. The wording
// is mine, not the standard's, so check it against the standard before relying
// on it in an interview.
export const ISO_ENTRIES: IsoEntry[] = [
  {
    id: "4.1",
    title: "Understanding the organization and its context",
    area: "Clause 4, Context of the organization",
    asks: "Work out the outside and inside factors (laws, threats, technology, culture, resources) that affect whether the security system can do its job.",
    stack:
      "The threat model and the README's known limits are this: they say what my box faces (a home network, bank data, one person running it).",
    question:
      "Name one external and one internal issue that would shape a security programme at a payments startup.",
  },
  {
    id: "4.2",
    title: "Understanding the needs and expectations of interested parties",
    area: "Clause 4, Context of the organization",
    asks: "List who cares about your information security (customers, regulators, staff, suppliers) and which of their requirements you have to meet.",
    stack:
      "For my platform the parties are me, my bank (Akahu terms), and Anthropic's API terms. I have not written the requirements down as a list.",
    question:
      "How does an interested party's requirement become something an auditor can check?",
  },
  {
    id: "4.3",
    title: "Determining the scope of the ISMS",
    area: "Clause 4, Context of the organization",
    asks: "Decide and write down exactly what the security system covers: which sites, systems, processes and interfaces are in, and which are out.",
    stack:
      "My scope would be the mini PC stack, the repo and the CI that builds the image. My Mac and the Azure labs are outside it.",
    question:
      "What goes wrong if the scope is drawn too narrowly just to make certification easier?",
  },
  {
    id: "4.4",
    title: "Information security management system",
    area: "Clause 4, Context of the organization",
    asks: "Actually run a management system: set it up, keep it going and keep improving it, including the processes it needs and how they connect.",
    stack:
      "My per-phase loop (plan, build, attack my own work, document, review) is a small version of this cycle.",
    question:
      "What is the difference between having security controls and having a management system?",
  },
  {
    id: "5.1",
    title: "Leadership and commitment",
    area: "Clause 5, Leadership",
    asks: "Top management has to own the system: set the direction, give it resources, fold it into normal work and make sure it achieves its results.",
    stack:
      "On my own I am top management. The honest evidence is that I fund the time and review the results each phase.",
    question:
      "How can an auditor tell the difference between real leadership commitment and a signed policy?",
  },
  {
    id: "5.2",
    title: "Policy",
    area: "Clause 5, Leadership",
    asks: "Top management sets a written security policy that fits the organization, includes objectives or a framework for them, and commits to meeting requirements and improving.",
    stack:
      "SECURITY.md tells outsiders how to report a problem, but I have no internal policy document. That is a real gap.",
    question:
      "Who must be able to see the policy, and how do you show it was communicated?",
  },
  {
    id: "5.3",
    title: "Organizational roles, responsibilities and authorities",
    area: "Clause 5, Leadership",
    asks: "Assign and communicate who is responsible for what in the system, including who reports its performance to top management.",
    stack:
      "I hold every role, which is the classic small-team problem: no separation between who builds and who approves.",
    question:
      "Which two roles should never be held by the same person, and why?",
  },
  {
    id: "6.1.1",
    title: "Actions to address risks and opportunities: general",
    area: "Clause 6, Planning",
    asks: "When planning, use your context and the parties' requirements to decide which risks and opportunities need action, then plan and check that action.",
    stack:
      "RISK_ASSESSMENT.md is where my risks live, each with an R number and a decision.",
    question:
      "Why does the standard talk about opportunities as well as risks?",
  },
  {
    id: "6.1.2",
    title: "Information security risk assessment",
    area: "Clause 6, Planning",
    asks: "Define a repeatable way to assess risk: how you judge likelihood and impact, what level you will accept, who owns each risk, and how you rank them.",
    stack:
      "My R-numbered risks have an owner (me) and an accept or fix decision. What I lack is written acceptance criteria.",
    question: "Why must the method produce comparable results year to year?",
  },
  {
    id: "6.1.3",
    title: "Information security risk treatment",
    area: "Clause 6, Planning",
    asks: "Choose how to treat each risk, pick the controls needed, compare them with Annex A so none is missed, and write the Statement of Applicability. Risk owners approve the plan and the leftover risk.",
    stack:
      "My ADRs and the accepted-risk entries do this job in a looser way. The Statement of Applicability is the piece I do not have.",
    question:
      "What does a Statement of Applicability contain, and what must you say about a control you exclude?",
  },
  {
    id: "6.2",
    title: "Information security objectives and planning to achieve them",
    area: "Clause 6, Planning",
    asks: "Set security objectives that fit the policy, are measurable where possible, and say what will be done, by whom, with what, by when and how it will be judged.",
    stack:
      "My phases each have a done-when, such as signed images only being deployed. They are goals, but I do not measure them over time.",
    question:
      "Give one measurable security objective and how you would track it.",
  },
  {
    id: "6.3",
    title: "Planning of changes",
    area: "Clause 6, Planning",
    asks: "When the security system itself has to change, make the change in a planned way, not ad hoc.",
    stack:
      "Every change goes through a pull request into a protected main with CI checks, which is planned change for the code.",
    question:
      "How is changing the management system different from change management for IT systems?",
  },
  {
    id: "7.1",
    title: "Resources",
    area: "Clause 7, Support",
    asks: "Work out and provide the people, money, tools and time the system needs.",
    stack:
      "The box, the API budget and my evenings are the resources. The API key expiry on a fixed date is one resource risk I track.",
    question:
      "How would you show an auditor that a security team is adequately resourced?",
  },
  {
    id: "7.2",
    title: "Competence",
    area: "Clause 7, Support",
    asks: "Decide what skills the people doing security work need, make sure they have them (training, experience), and keep evidence.",
    stack:
      "My Field Notes, study notes and diary entries are my evidence that I am learning what I operate.",
    question: "What counts as evidence of competence besides a certificate?",
  },
  {
    id: "7.3",
    title: "Awareness",
    area: "Clause 7, Support",
    asks: "Everyone working under the system should know the policy, how their work helps security and what happens if they ignore it.",
    stack:
      "No staff, so this reduces to me knowing my own rules, such as never pasting a token into chat.",
    question: "How would you measure whether awareness training works?",
  },
  {
    id: "7.4",
    title: "Communication",
    area: "Clause 7, Support",
    asks: "Decide what security information is communicated, when, to whom and how, inside and outside the organization.",
    stack:
      "Telegram alerts and the /status command are my internal channel, and SECURITY.md is the outside one.",
    question:
      "Who needs to be told, and how fast, when a security incident starts?",
  },
  {
    id: "7.5",
    title: "Documented information",
    area: "Clause 7, Support",
    asks: "Keep the documents the standard requires and the ones you decide you need, and control how they are created, approved, stored, versioned and retired.",
    stack:
      "ADRs, the threat model and the risk assessment live in git, so history and review come free. That is a strong pattern.",
    question:
      "What is the difference between a document and a record, and why does it matter at audit?",
  },
  {
    id: "8.1",
    title: "Operational planning and control",
    area: "Clause 8, Operation",
    asks: "Run the processes that make the plan real, control planned changes, deal with unplanned ones and keep control over outsourced work.",
    stack:
      "The release workflow and the nightly updater are controlled, repeatable processes with a rollback.",
    question:
      "How do you keep control of a process you have outsourced to a supplier?",
  },
  {
    id: "8.2",
    title: "Information security risk assessment",
    area: "Clause 8, Operation",
    asks: "Actually do the risk assessments, at planned intervals and whenever a significant change is proposed or happens, and keep the results.",
    stack:
      "I re-ran my threat model after each big step (batches A to F). I did not do it on a calendar.",
    question: "Why is a one-off risk assessment not enough for the standard?",
  },
  {
    id: "8.3",
    title: "Information security risk treatment",
    area: "Clause 8, Operation",
    asks: "Carry out the risk treatment plan and keep the results.",
    stack:
      "A finding from my attack batches became a fix, a test and a note. That chain is the evidence.",
    question: "What would you show an auditor to prove a risk was treated?",
  },
  {
    id: "9.1",
    title: "Monitoring, measurement, analysis and evaluation",
    area: "Clause 9, Performance evaluation",
    asks: "Decide what to measure about security and the system, how, when and who looks at it, then evaluate how well it is performing.",
    stack:
      "Job heartbeats, the watchdog and the audit workflow are my measurements. I do not trend them over time.",
    question:
      "What is the difference between a metric that is measured and one that is actually used?",
  },
  {
    id: "9.2",
    title: "Internal audit",
    area: "Clause 9, Performance evaluation",
    asks: "Audit the system yourself at planned intervals against your own rules and the standard, using auditors who are objective and impartial, and report the results.",
    stack:
      "My attack batches are the closest thing, but I audit my own work, so they are not impartial.",
    question: "Why does impartiality matter, and how does a small team get it?",
  },
  {
    id: "9.3",
    title: "Management review",
    area: "Clause 9, Performance evaluation",
    asks: "Top management reviews the system at planned intervals, looking at set inputs (audit results, risks, changes, feedback) and recording decisions on improvements and changes.",
    stack:
      "My end-of-phase review is similar, but nothing forces it on a schedule.",
    question: "Name three inputs a management review must consider.",
  },
  {
    id: "10.1",
    title: "Continual improvement",
    area: "Clause 10, Improvement",
    asks: "Keep improving how suitable, adequate and effective the system is.",
    stack:
      "Each phase's lessons feed the next: the watchdog caught a timer I forgot to install, and that became a documented finding.",
    question: "How would you show continual improvement over two audit years?",
  },
  {
    id: "10.2",
    title: "Nonconformity and corrective action",
    area: "Clause 10, Improvement",
    asks: "When something does not meet a requirement, react and fix it, find out why, check whether it could happen elsewhere, act, check the fix worked and keep records.",
    stack:
      "The updater timer I forgot to install is a nonconformity: it was found by the watchdog, fixed and written up.",
    question:
      "What is the difference between a correction and a corrective action?",
  },
  {
    id: "A.5.1",
    title: "Policies for information security",
    area: "Annex A, Organizational",
    asks: "Have an overall security policy plus topic-specific ones, approved by management, shared with staff and reviewed when things change.",
    stack:
      "I have SECURITY.md and README limits, but no internal policy set. I would start with access, secrets and acceptable use.",
    question:
      "What is the difference between a policy, a standard and a procedure?",
  },
  {
    id: "A.5.2",
    title: "Information security roles and responsibilities",
    area: "Annex A, Organizational",
    asks: "Define and allocate security responsibilities so everyone knows what they own.",
    stack:
      "I own everything, so the roles collapse into one person. Writing them out would show which hat I wear for each task.",
    question: "How would you document who owns a risk?",
  },
  {
    id: "A.5.3",
    title: "Segregation of duties",
    area: "Annex A, Organizational",
    asks: "Keep conflicting duties and areas of responsibility apart to reduce the chance of fraud or error going unnoticed.",
    stack:
      "A protected main with pull requests is a partial control, but I approve my own merges. CI is the only second pair of eyes.",
    question:
      "What compensating control would you add when a team is too small to separate duties?",
  },
  {
    id: "A.5.4",
    title: "Management responsibilities",
    area: "Annex A, Organizational",
    asks: "Management must make sure staff follow the security policies and procedures.",
    stack:
      "Nobody to manage, so my equivalent is enforcing rules through tooling: the pre-commit secret scan and required CI checks.",
    question:
      "Why is enforcement by tooling stronger than enforcement by instruction?",
  },
  {
    id: "A.5.5",
    title: "Contact with authorities",
    area: "Annex A, Organizational",
    asks: "Know which authorities to contact (regulators, police, emergency services) and when, and keep that contact information ready.",
    stack:
      "I have not written one down. For a breach involving personal data in New Zealand, I would need to know who to notify.",
    question:
      "Name two authorities an organization may need to contact after a data breach.",
  },
  {
    id: "A.5.6",
    title: "Contact with special interest groups",
    area: "Annex A, Organizational",
    asks: "Stay in touch with security forums and professional bodies so you hear about threats and good practice.",
    stack:
      "GitHub security advisories and Dependabot alerts are my feed, and they caught the body-parser advisory.",
    question:
      "What would you do when you learn about a new vulnerability through one of these groups?",
  },
  {
    id: "A.5.7",
    title: "Threat intelligence",
    area: "Annex A, Organizational",
    asks: "Collect and analyse information about threats so you can act on it, at strategic, tactical and operational levels.",
    stack:
      "Advisory feeds drive my dependency scanning. The threat model is where I turn that into decisions about my own system.",
    question: "What turns threat information into threat intelligence?",
  },
  {
    id: "A.5.8",
    title: "Information security in project management",
    area: "Annex A, Organizational",
    asks: "Build security into every project, whatever its type, from the start.",
    stack:
      "Each phase of my project gets a threat model section and an attack batch before it is called done.",
    question: "At which project stage is security cheapest to add?",
  },
  {
    id: "A.5.9",
    title: "Inventory of information and other associated assets",
    area: "Annex A, Organizational",
    asks: "Keep an inventory of information and the assets that handle it, each with an owner.",
    stack:
      "My services and data are listed in the README and compose file, but there is no formal asset register.",
    question: "What fields would you put in an asset register?",
  },
  {
    id: "A.5.10",
    title: "Acceptable use of information and other associated assets",
    area: "Annex A, Organizational",
    asks: "Write rules for how information and assets may be used and handled, and make people aware of them.",
    stack:
      "I have personal rules such as never putting secrets in chat. Nothing written for anyone else.",
    question:
      "Who needs to agree to an acceptable use policy, and how is that recorded?",
  },
  {
    id: "A.5.11",
    title: "Return of assets",
    area: "Annex A, Organizational",
    asks: "When people leave or change role, make sure they hand back the organization's assets.",
    stack:
      "Not applicable at one person. The offline Azure DevOps agent and its token I still have to revoke is the same idea.",
    question: "What is on a leaver checklist besides the laptop?",
  },
  {
    id: "A.5.12",
    title: "Classification of information",
    area: "Annex A, Organizational",
    asks: "Classify information by confidentiality, integrity and availability needs and legal requirements.",
    stack:
      "My bank data and notes are my most sensitive. The model only ever sees masked descriptions and totals, which is classification driving a control.",
    question: "How does a classification scheme change what you do with data?",
  },
  {
    id: "A.5.13",
    title: "Labelling of information",
    area: "Annex A, Organizational",
    asks: "Label information in line with the classification scheme so people know how to handle it.",
    stack:
      "I do not label anything. The nearest thing is keeping finance data in its own tables behind a read-only role.",
    question:
      "Why might labelling be more useful for paper than for databases?",
  },
  {
    id: "A.5.14",
    title: "Information transfer",
    area: "Annex A, Organizational",
    asks: "Set rules for moving information inside the organization and to others, whatever the channel.",
    stack:
      "The bot only answers my chat, finance data only goes out masked, and signed images move by digest.",
    question: "Name three transfer channels and one control for each.",
  },
  {
    id: "A.5.15",
    title: "Access control",
    area: "Annex A, Organizational",
    asks: "Set and apply rules for who may access information and assets, based on business and security needs.",
    stack:
      "The bot checks private chat, chat ID and sender ID. The MCP server needs a bearer token. The dashboard is only on localhost.",
    question: "What does need-to-know mean in practice?",
  },
  {
    id: "A.5.16",
    title: "Identity management",
    area: "Annex A, Organizational",
    asks: "Manage the whole life of identities: create, change and remove them.",
    stack:
      "Few identities: me, the deploy key and the CI identity that signs images. The deploy key is read-only.",
    question: "What goes wrong when service identities are not tracked?",
  },
  {
    id: "A.5.17",
    title: "Authentication information",
    area: "Annex A, Organizational",
    asks: "Control how secrets used to prove identity (passwords, tokens, keys) are allocated and handled.",
    stack:
      "Tokens live in .env on the box, are at least 32 characters, and can be rotated by adding a new one first. I did paste two into chat once.",
    question: "How would you rotate a leaked credential without downtime?",
  },
  {
    id: "A.5.18",
    title: "Access rights",
    area: "Annex A, Organizational",
    asks: "Provide, review, change and remove access rights according to the access control rules.",
    stack:
      "The dashboard database role is SELECT-only. I have not scheduled access reviews.",
    question: "How often should access rights be reviewed, and by whom?",
  },
  {
    id: "A.5.19",
    title: "Information security in supplier relationships",
    area: "Annex A, Organizational",
    asks: "Set processes to manage the security risks of using suppliers.",
    stack:
      "My suppliers are Akahu, Anthropic, GitHub, Telegram and Open-Meteo. I assess them loosely, in ADRs, not in a register.",
    question: "How would you decide how much scrutiny a supplier deserves?",
  },
  {
    id: "A.5.20",
    title: "Addressing information security within supplier agreements",
    area: "Annex A, Organizational",
    asks: "Agree security requirements with each supplier, based on the type of relationship.",
    stack:
      "I accept standard terms. The practical control is limiting what I send them.",
    question: "What would you ask for in a contract with a cloud supplier?",
  },
  {
    id: "A.5.21",
    title: "Managing information security in the ICT supply chain",
    area: "Annex A, Organizational",
    asks: "Manage security risks in the chain of products and services you depend on.",
    stack:
      "This is my Phase 14: Dependabot with a cooldown, an audit job, pinned digests and checksums, signed images.",
    question: "How does a signature help and where does it stop helping?",
  },
  {
    id: "A.5.22",
    title: "Monitoring, review and change management of supplier services",
    area: "Annex A, Organizational",
    asks: "Regularly check that suppliers still meet the agreed security level and manage their changes.",
    stack:
      "The watchdog tells me when a supplier-dependent job fails. I do not review the suppliers themselves.",
    question: "What would you review about a supplier every year?",
  },
  {
    id: "A.5.23",
    title: "Information security for use of cloud services",
    area: "Annex A, Organizational",
    asks: "Set rules to acquire, use, manage and leave cloud services securely.",
    stack:
      "I use GitHub, its Actions and a container registry. The platform itself runs at home on purpose.",
    question: "What do you need to agree before you leave a cloud service?",
  },
  {
    id: "A.5.24",
    title: "Information security incident management planning and preparation",
    area: "Annex A, Organizational",
    asks: "Plan how incidents will be managed: roles, process and communication, before one happens.",
    stack:
      "My plan is informal: the watchdog alerts me and the /status command shows state. No written playbook.",
    question: "What belongs in the first page of an incident plan?",
  },
  {
    id: "A.5.25",
    title: "Assessment and decision on information security events",
    area: "Annex A, Organizational",
    asks: "Assess each security event and decide whether it counts as an incident.",
    stack:
      "A failing audit job is an event. It only becomes an incident if it shows a real flaw, as the advisory did.",
    question: "What is the difference between an event and an incident?",
  },
  {
    id: "A.5.26",
    title: "Response to information security incidents",
    area: "Annex A, Organizational",
    asks: "Respond to incidents following the documented procedures.",
    stack:
      "The updater rolls back by itself if a new image does not stay up. That is an automated response.",
    question: "What should you do in the first hour of a suspected breach?",
  },
  {
    id: "A.5.27",
    title: "Learning from information security incidents",
    area: "Annex A, Organizational",
    asks: "Use what incidents teach you to strengthen controls.",
    stack:
      "The lost Telegram message led to a retry, and the watchdog caught a forgotten timer that I then wrote up.",
    question: "How do you prove lessons were actually applied?",
  },
  {
    id: "A.5.28",
    title: "Collection of evidence",
    area: "Annex A, Organizational",
    asks: "Have procedures to identify, collect and preserve evidence of security events.",
    stack:
      "Job runs are recorded in a table and the MCP server logs a line for each request.",
    question: "Why does evidence need a chain of custody?",
  },
  {
    id: "A.5.29",
    title: "Information security during disruption",
    area: "Annex A, Organizational",
    asks: "Plan how to keep security in place while operations are disrupted.",
    stack:
      "During the house move the firewall stayed closed to the new network until I allowed it, which is security holding during disruption.",
    question: "What security controls tend to get dropped in an emergency?",
  },
  {
    id: "A.5.30",
    title: "ICT readiness for business continuity",
    area: "Annex A, Organizational",
    asks: "Plan and test ICT so business continuity goals can be met.",
    stack:
      "Local backups exist. Off-box backups are on my open-risk list, and a restore test would prove them.",
    question: "What does a backup have to prove before you can rely on it?",
  },
  {
    id: "A.5.31",
    title: "Legal, statutory, regulatory and contractual requirements",
    area: "Annex A, Organizational",
    asks: "Identify the legal and contractual rules that apply and keep up with them.",
    stack:
      "New Zealand's privacy law covers personal information. I have not mapped it to my platform.",
    question: "How would you keep a register of legal requirements current?",
  },
  {
    id: "A.5.32",
    title: "Intellectual property rights",
    area: "Annex A, Organizational",
    asks: "Protect intellectual property, including by respecting licences.",
    stack:
      "I avoid copying the standard's text, and my repo's dependencies come with their licences.",
    question:
      "What is the risk of using an open source package with the wrong licence?",
  },
  {
    id: "A.5.33",
    title: "Protection of records",
    area: "Annex A, Organizational",
    asks: "Protect records from loss, destruction, falsification and unauthorised access or release.",
    stack:
      "Git history gives me tamper-evident records for decisions and docs. Database records rely on backups.",
    question: "How do you show a record has not been altered?",
  },
  {
    id: "A.5.34",
    title: "Privacy and protection of PII",
    area: "Annex A, Organizational",
    asks: "Meet your obligations to protect personal information, as the law and contracts require.",
    stack:
      "Bank data stays in my own database. Only masked descriptions and totals go to the model API.",
    question:
      "What is the difference between data minimisation and data masking?",
  },
  {
    id: "A.5.35",
    title: "Independent review of information security",
    area: "Annex A, Organizational",
    asks: "Have the security approach reviewed independently at planned intervals and after big changes.",
    stack:
      "My reviews are self-reviews, which is the gap. A friend or a paid tester would give me independence.",
    question: "What makes a review independent?",
  },
  {
    id: "A.5.36",
    title:
      "Compliance with policies, rules and standards for information security",
    area: "Annex A, Organizational",
    asks: "Regularly check that people and systems follow your security policies and standards.",
    stack:
      "CI is the continuous check: secret scan, audit, tests. It enforces my rules on every change.",
    question: "How would you check compliance on a system with no pipeline?",
  },
  {
    id: "A.5.37",
    title: "Documented operating procedures",
    area: "Annex A, Organizational",
    asks: "Document operating procedures and make them available to whoever needs them.",
    stack:
      "The README's Deploys section, the updater script's header and the demo script are my runbooks.",
    question: "What makes a runbook usable at 3am?",
  },
  {
    id: "A.6.1",
    title: "Screening",
    area: "Annex A, People",
    asks: "Check the background of candidates before they join, in proportion to the role and within the law.",
    stack:
      "No hires, so nothing to screen. The same idea applies to anyone I would give access to the repo or the box.",
    question:
      "How far should screening go for someone who will have admin access?",
  },
  {
    id: "A.6.2",
    title: "Terms and conditions of employment",
    area: "Annex A, People",
    asks: "Put security responsibilities into the contracts that staff and contractors sign.",
    stack:
      "Not applicable as a one-person project. It would sit alongside my acceptable use rules.",
    question: "Which security duties should still apply after someone leaves?",
  },
  {
    id: "A.6.3",
    title: "Information security awareness, education and training",
    area: "Annex A, People",
    asks: "Give people appropriate security training, refreshed regularly and matched to their role.",
    stack:
      "My study notes and Field Notes are my own training record. Spending the time is the control.",
    question:
      "How would you tailor training for developers compared with finance staff?",
  },
  {
    id: "A.6.4",
    title: "Disciplinary process",
    area: "Annex A, People",
    asks: "Have a formal, communicated process for acting against people who break security rules.",
    stack:
      "Not applicable to me. The tooling version is that a failing check blocks a merge.",
    question: "Why must the disciplinary process be communicated beforehand?",
  },
  {
    id: "A.6.5",
    title: "Responsibilities after termination or change of employment",
    area: "Annex A, People",
    asks: "Define which security duties continue after someone leaves or changes role, and tell them.",
    stack:
      "The matching task for me is revoking things that outlive their use, like an old agent token.",
    question: "What access should be removed on the day someone changes role?",
  },
  {
    id: "A.6.6",
    title: "Confidentiality or non-disclosure agreements",
    area: "Annex A, People",
    asks: "Use signed confidentiality agreements that reflect what the organization needs to protect.",
    stack:
      "My repo is public, so nothing confidential belongs in it. Secret scanning and a pre-commit hook enforce that.",
    question: "When would you require an NDA from a supplier?",
  },
  {
    id: "A.6.7",
    title: "Remote working",
    area: "Annex A, People",
    asks: "Protect information accessed, processed or stored outside the organization's own premises.",
    stack:
      "I reach the box over SSH, and the dashboard is only reachable through an SSH tunnel. Nothing sits open to the internet.",
    question: "What are the top three controls for a remote worker's laptop?",
  },
  {
    id: "A.6.8",
    title: "Information security event reporting",
    area: "Annex A, People",
    asks: "Give people a clear, easy channel to report security events they see or suspect, quickly.",
    stack:
      "SECURITY.md offers private vulnerability reporting to outsiders, and the watchdog reports events to me.",
    question:
      "What makes people hesitate to report an event, and how do you fix it?",
  },
  {
    id: "A.7.1",
    title: "Physical security perimeters",
    area: "Annex A, Physical",
    asks: "Define the boundaries of areas that hold information and protect them with suitable barriers.",
    stack:
      "My perimeter is my home. The box is only as physically safe as the house.",
    question: "How would you decide where a perimeter should be?",
  },
  {
    id: "A.7.2",
    title: "Physical entry",
    area: "Annex A, Physical",
    asks: "Control who can enter secure areas through entry controls and access points.",
    stack:
      "Anyone in the house could touch the box. The mitigation is that the data is only useful with my credentials, though there is no disk encryption.",
    question: "How do visitors differ from staff in an access control scheme?",
  },
  {
    id: "A.7.3",
    title: "Securing offices, rooms and facilities",
    area: "Annex A, Physical",
    asks: "Design and apply physical security for the rooms and buildings that hold information.",
    stack:
      "Home setup, so there is no dedicated room. That is an accepted limit.",
    question: "What would change if the server room were in a shared building?",
  },
  {
    id: "A.7.4",
    title: "Physical security monitoring",
    area: "Annex A, Physical",
    asks: "Monitor premises continuously for unauthorised physical access.",
    stack:
      "I do not monitor the room. My dead-man's switch only tells me when the box stops reporting.",
    question:
      "What is the difference between detecting and preventing physical intrusion?",
  },
  {
    id: "A.7.5",
    title: "Protecting against physical and environmental threats",
    area: "Annex A, Physical",
    asks: "Protect against fire, flood, heat, tampering and other natural and human physical threats.",
    stack:
      "Nothing specific. A fire or flood at home would take the box and any local backup with it, which is why off-box backups are on my open list.",
    question: "Which of these threats does an off-site backup protect against?",
  },
  {
    id: "A.7.6",
    title: "Working in secure areas",
    area: "Annex A, Physical",
    asks: "Set rules for working inside secure areas, such as supervision and no unauthorised recording.",
    stack: "No secure area exists in my setup, so this does not apply.",
    question: "When would you restrict phones or cameras in a secure area?",
  },
  {
    id: "A.7.7",
    title: "Clear desk and clear screen",
    area: "Annex A, Physical",
    asks: "Keep papers, media and screens from exposing information to people who should not see it.",
    stack:
      "My phone shows the bot chat with spending in it. A screen lock on the phone and Mac is the control that would matter, and I have not written it down.",
    question:
      "How do you make a clear desk policy practical in an open office?",
  },
  {
    id: "A.7.8",
    title: "Equipment siting and protection",
    area: "Annex A, Physical",
    asks: "Place and protect equipment to reduce environmental risks and unauthorised access.",
    stack:
      "The box sits at home and uses Wi-Fi through a USB adapter, and my firewall rules are written around that adapter.",
    question: "What should you consider when choosing where a server goes?",
  },
  {
    id: "A.7.9",
    title: "Security of assets off-premises",
    area: "Annex A, Physical",
    asks: "Protect devices and assets that leave the main premises.",
    stack:
      "My Mac travels and holds the repo clone and a development database. Disk encryption and a screen lock matter most there.",
    question: "What happens if a company laptop is lost on a train?",
  },
  {
    id: "A.7.10",
    title: "Storage media",
    area: "Annex A, Physical",
    asks: "Manage storage media through its life, from use to transport to disposal, in line with classification.",
    stack:
      "My backups sit on the same box for now. Any external drive I add will need encryption and a place.",
    question: "How would you handle a USB stick found in the car park?",
  },
  {
    id: "A.7.11",
    title: "Supporting utilities",
    area: "Annex A, Physical",
    asks: "Protect equipment from power cuts and other utility failures.",
    stack:
      "A power cut or a dropped Wi-Fi link would stop my jobs, and the dead-man's switch would tell me.",
    question: "What does a UPS protect against, and what does it not?",
  },
  {
    id: "A.7.12",
    title: "Cabling security",
    area: "Annex A, Physical",
    asks: "Protect power and network cabling from interception, interference and damage.",
    stack:
      "My box talks over Wi-Fi, so the radio link is the exposure. Firewall and SSH keys are the controls.",
    question:
      "Why might wireless traffic need different protection from cabled traffic?",
  },
  {
    id: "A.7.13",
    title: "Equipment maintenance",
    area: "Annex A, Physical",
    asks: "Maintain equipment correctly so it stays available and its information stays safe.",
    stack:
      "I upgraded the box, turned on unattended security updates and run a nightly image update.",
    question: "What should happen to a disk before it goes for repair?",
  },
  {
    id: "A.7.14",
    title: "Secure disposal or re-use of equipment",
    area: "Annex A, Physical",
    asks: "Check equipment holding storage media and remove or securely overwrite sensitive data before disposal or re-use.",
    stack:
      "The box holds bank transactions and has no disk encryption, so a wipe would be needed before it left the house.",
    question: "Why is deleting files not the same as securely erasing a disk?",
  },
];
