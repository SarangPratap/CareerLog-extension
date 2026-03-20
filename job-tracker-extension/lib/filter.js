const KNOWN_ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "workday.com",
  "myworkdayjobs.com",
  "taleo.net",
  "icims.com",
  "jobvite.com",
  "smartrecruiters.com",
  "ashbyhq.com",
  "rippling.com",
  "bamboohr.com",
  "paylocity.com",
  "recruitee.com",
  "breezy.hr",
  "jazz.co",
  "applytojob.com",
  "successfactors.com",
  "oraclecloud.com",
  "adp.com",
  "workable.com",
  "pinpointhq.com",
  "personio.com",
  "teamtailor.com"
];

const JOB_KEYWORDS = {
  high: [
    "application received",
    "thank you for applying",
    "we received your application",
    "your application for",
    "interview invitation",
    "schedule an interview",
    "move forward with your application",
    "offer letter",
    "pleased to offer",
    "background check",
    "unfortunately.*not.*moving forward",
    "regret to inform"
  ],
  medium: [
    "hiring manager",
    "recruitment team",
    "talent acquisition",
    "next steps",
    "your candidacy",
    "position of",
    "role of"
  ],
  negative: [
    "job alert",
    "jobs you might like",
    "jobs matching your profile",
    "weekly digest",
    "salary report",
    "resume tips",
    "career advice",
    "top jobs",
    "recommended jobs"
  ]
};

function isFromKnownATS(senderEmail) {
  const domain = senderEmail.split("@")[1]?.toLowerCase();
  return KNOWN_ATS_DOMAINS.some((atsDomain) => domain?.includes(atsDomain));
}

function scoreEmail(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  let score = 0;

  for (const keyword of JOB_KEYWORDS.high) {
    if (new RegExp(keyword).test(text)) {
      score += 3;
    }
  }

  for (const keyword of JOB_KEYWORDS.medium) {
    if (text.includes(keyword)) {
      score += 1;
    }
  }

  for (const keyword of JOB_KEYWORDS.negative) {
    if (text.includes(keyword)) {
      score -= 2;
    }
  }

  return score;
}

function passesKeywordFilter(subject, body) {
  return scoreEmail(subject, body) >= 2;
}

async function shouldProcessEmail(email, apiKey, provider) {
  if (isFromKnownATS(email.from)) {
    return { process: true, fastTrack: true };
  }

  if (!passesKeywordFilter(email.subject, email.body)) {
    return { process: false, reason: "keyword_filter" };
  }

  const classification = await classifyEmail(email.subject, email.body, apiKey, provider);

  if (!classification.isJobRelated || classification.confidence === "low") {
    return { process: false, reason: "ai_classified_irrelevant" };
  }

  return { process: true, classification };
}

globalThis.JOB_KEYWORDS = JOB_KEYWORDS;
globalThis.KNOWN_ATS_DOMAINS = KNOWN_ATS_DOMAINS;
globalThis.isFromKnownATS = isFromKnownATS;
globalThis.scoreEmail = scoreEmail;
globalThis.passesKeywordFilter = passesKeywordFilter;
globalThis.shouldProcessEmail = shouldProcessEmail;
