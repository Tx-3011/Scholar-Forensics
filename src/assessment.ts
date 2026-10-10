import type { ForensicsReport } from "./analyze.js";
import { networkSignals, type IntegrityEvidence } from "./integrity.js";

export function assess(report: ForensicsReport, evidence?: IntegrityEvidence) {
  const signals = networkSignals(evidence);
  const reasons: string[] = [];
  let level: "retracted" | "strong" | "possible" | "review" | "fine" | "insufficient" = "insufficient";
  let title = "Insufficient evidence to assess cartel risk";
  let action = "Complete the reference-network check before relying on this assessment.";
  let basis: "sample" | "reference-network" = evidence?.works.length ? "reference-network" : "sample";
  const refConcentrated = signals.referenceCount >= 10 && signals.topReferenceVenueShare >= 0.5;
  if (evidence?.retraction.status === "verified") {
    basis = "reference-network";
    level = "retracted"; title = "Retracted — do not treat this paper as reliable";
    reasons.push("Crossref records a retraction for the matched paper DOI. A low anomaly index cannot override this.");
    action = "Read the linked retraction notice for the reason; retraction alone does not establish a citation cartel.";
  } else if (evidence?.retraction.status === "title-warning" || /^\s*(?:\[.*?\]\s*)?retracted\s*:/i.test(report.target.title)) {
    level = "review"; title = "Retraction warning — check the publisher notice";
    reasons.push("The paper title is marked RETRACTED, but a DOI-linked retraction has not been verified.");
    action = "Verify the paper's status before using it.";
  } else if (signals.ringTeams >= 3 && signals.ringDensity >= 0.5 && signals.reciprocalPairs >= 2 && refConcentrated) {
    level = "strong"; title = "Strong cartel signals — investigate before relying on it";
    reasons.push("A dense citation cycle connects at least three candidate author teams, with multiple reciprocal pairs and concentrated target references.");
    action = "Check author identities, citation passages, relevance, and a field-matched baseline. Coordination is not proven.";
  } else if (signals.ringTeams >= 3) {
    level = "possible"; title = "Possible citation cartel — review needed";
    reasons.push("Deposited reference DOIs form a citation cycle involving the target's team and at least two other candidate teams.");
    action = "Inspect the linked citation edges and verify whether the citations are relevant. Normal scholarly exchange can produce cycles.";
  } else if (refConcentrated || signals.reciprocalPairs > 0 || (report.anomalyScore !== null &&
      (report.anomalyScore >= 0.3 || report.venueConcentration.topVenueShare >= 0.5))) {
    level = "review"; title = "Citation concerns — cartel not established";
    reasons.push(refConcentrated ? "At least half of the target's references share one deposited journal label." : signals.reciprocalPairs ? "Two candidate author teams cite each other in the checked reference network." : report.venueConcentration.topVenueShare >= 0.5 ? "At least half of sampled citing papers share one publication venue label; verify shortened labels and legitimate subject-area explanations." : "The incoming-citation sample exceeds the heuristic review threshold.");
    action = "Review citation relevance and legitimate explanations before drawing a conclusion.";
  } else if (report.anomalyScore !== null && evidence?.status === "completed" &&
      evidence.matchedCiters >= 10 && signals.citersWithReferences >= 10 && signals.targetTeamUsable &&
      signals.referenceCount >= 10 && signals.depositedReferences >= signals.referenceCount * 0.8) {
    level = "fine"; title = "Looks fine in the checked evidence";
    reasons.push("No registered retraction, target-team citation ring, or threshold-level concentration was found in this bounded check.");
    action = "This is a screening result, not certification of the paper's validity; review its methods and findings separately.";
  } else if (report.anomalyScore !== null && report.citersAnalyzed >= 10 &&
      report.evidenceQuality.missingAuthors <= report.citersAnalyzed * 0.2) {
    level = "fine"; basis = "sample"; title = "Looks fine in the sampled citations";
    reasons.push(`No threshold-level citation-pattern concern was detected in the ${report.citersAnalyzed} analyzed citers. The paper's total citation count does not affect this sample assessment.`);
    reasons.push("Reference-network or retraction evidence is incomplete. This result does not rule out a cartel or establish that the paper is valid.");
    action = "Use this as the hackathon sample assessment; inspect the separate reference-check status for checks that could not be completed.";
  } else {
    reasons.push(!evidence ? "Reference-network and retraction checks have not run for this saved report." : evidence.status === "unavailable" ? "Crossref metadata could not be retrieved or matched reliably." : "Too few complete, matched reference records are available for a reassuring result.");
    action = "Check the evidence coverage below. Missing metadata must not be treated as low risk.";
  }
  if (signals.ringTeams > 1) reasons.push(`${signals.ringTeams} candidate teams in the target-connected cycle; ${signals.reciprocalPairs} reciprocal team pair(s).`);
  if (signals.topReferenceVenueCount) reasons.push(`${signals.topReferenceVenueCount} of ${signals.referenceCount} target references (${Math.round(signals.topReferenceVenueShare * 100)}%) have the journal label “${signals.topReferenceVenue}”.`);
  return { level, title, reasons, action, signals, basis, ruleVersion: "cartel-screen-v2", caveat: "Assessment applies to the retrieved sample (maximum 100 citers), not all citations. Rule-based screening, not a calibrated probability or proof of collusion." };
}
