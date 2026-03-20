// lib/filter.js
// 4-layer email filter. Run in order — only call AI if all free layers pass.

var KNOWN_ATS_DOMAINS = [
  'greenhouse.io', 'lever.co', 'workday.com', 'myworkdayjobs.com',
  'taleo.net', 'icims.com', 'jobvite.com', 'smartrecruiters.com',
  'ashbyhq.com', 'rippling.com', 'bamboohr.com', 'paylocity.com',
  'recruitee.com', 'breezy.hr', 'jazz.co', 'applytojob.com',
  'successfactors.com', 'workable.com', 'pinpointhq.com',
  'personio.com', 'teamtailor.com', 'comeet.com', 'zohorecruit.com'
];

var JOB_KEYWORDS_HIGH = [
  'application received',
  'thank you for applying',
  'we received your application',
  'your application for',
  'application submitted',
  'interview invitation',
  'schedule an interview',
  'we would like to invite',
  'move forward with your application',
  'moving forward',
  'offer letter',
  'pleased to offer',
  'job offer',
  'background check',
  'regret to inform',
  'unfortunately.*not.*moving forward',
  'we will not be moving forward',
  'position has been filled',
  'not selected'
];

var JOB_KEYWORDS_MEDIUM = [
  'hiring manager',
  'recruitment team',
  'talent acquisition',
  'recruiter',
  'next steps',
  'your candidacy',
  'position of',
  'role of',
  'open position',
  'job opening'
];

var JOB_KEYWORDS_NEGATIVE = [
  'job alert',
  'jobs you might like',
  'jobs matching your profile',
  'new jobs for you',
  'weekly digest',
  'salary report',
  'resume tips',
  'career advice',
  'top jobs',
  'recommended jobs',
  'unsubscribe',
  'email preferences',
  'view in browser'
];

var isFromKnownATS = function(senderEmail) {
  if (!senderEmail) return false;
  var domain = senderEmail.split('@')[1];
  if (!domain) return false;
  domain = domain.toLowerCase();
  return KNOWN_ATS_DOMAINS.some(function(atsDomain) {
    return domain.indexOf(atsDomain) !== -1;
  });
};

var scoreEmail = function(subject, body) {
  var text = ((subject || '') + ' ' + (body || '')).toLowerCase();
  var score = 0;

  JOB_KEYWORDS_HIGH.forEach(function(kw) {
    try {
      if (new RegExp(kw).test(text)) score += 3;
    } catch(e) {
      if (text.indexOf(kw) !== -1) score += 3;
    }
  });

  JOB_KEYWORDS_MEDIUM.forEach(function(kw) {
    if (text.indexOf(kw) !== -1) score += 1;
  });

  JOB_KEYWORDS_NEGATIVE.forEach(function(kw) {
    if (text.indexOf(kw) !== -1) score -= 2;
  });

  return score;
};

var passesKeywordFilter = function(subject, body) {
  return scoreEmail(subject, body) >= 2;
};

// Master filter function — returns { process: true/false, reason, fastTrack }
var shouldProcessEmail = async function(email, apiKey, provider) {
  // Layer 1: Known ATS domain — fast track, skip other layers
  if (isFromKnownATS(email.from)) {
    return { process: true, fastTrack: true, reason: 'ats_domain' };
  }

  // Layer 2+3: Keyword scoring
  if (!passesKeywordFilter(email.subject, email.body)) {
    return { process: false, reason: 'keyword_score_too_low' };
  }

  // Layer 4: AI classification (only if API key present)
  if (!apiKey || !provider) {
    return { process: true, reason: 'no_ai_key_skip_classification' };
  }

  try {
    var classification = await classifyEmailWithAI(email.subject, email.body, apiKey, provider);
    if (!classification.isJobRelated || classification.confidence === 'low') {
      return { process: false, reason: 'ai_classified_irrelevant', classification: classification };
    }
    return { process: true, reason: 'ai_confirmed', classification: classification };
  } catch (err) {
    // If AI classification fails, pass through (don't block on AI errors)
    console.warn('[Careerlog] AI classification failed, passing through:', err.message);
    return { process: true, reason: 'ai_error_passthrough' };
  }
};
