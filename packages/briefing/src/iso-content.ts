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
];
