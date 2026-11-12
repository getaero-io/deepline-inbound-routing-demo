const weights = {
  industry: 45,
  specialty: 35,
  city: 10,
  education: 5,
  sports: 3,
  interests: 2,
} as const;

type Signal = keyof typeof weights;
export type FitAttributes = Partial<Record<Signal, readonly string[]>>;

export type RepFitCandidate = {
  id: string;
  attributes: FitAttributes;
};

export function rankRepFit<T extends RepFitCandidate>(
  lead: FitAttributes,
  candidates: readonly T[],
) {
  const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  const signals = Object.keys(weights) as Signal[];
  const leadValues = signals.map((signal) => ({
    signal,
    values: new Set((lead[signal] ?? []).map(normalize).filter(Boolean)),
  }));

  return candidates.map((rep) => {
    const reasons = leadValues.flatMap(({ signal, values }) =>
      rep.attributes[signal]?.some((value) => values.has(normalize(value)))
        ? [{ signal, points: weights[signal] }]
        : [],
    );
    return { rep, score: reasons.reduce((sum, reason) => sum + reason.points, 0), reasons };
  }).sort((a, b) => b.score - a.score || (a.rep.id < b.rep.id ? -1 : a.rep.id > b.rep.id ? 1 : 0));
}

export function selectRepBooking<T extends RepFitCandidate & { bookingUrl: string | null }>(
  lead: FitAttributes,
  candidates: readonly T[],
  fallbackUrl: string,
) {
  const eligible = candidates.filter(({ bookingUrl }) => bookingUrl !== null);
  const winner = rankRepFit(lead, eligible)[0];
  if (!winner || !winner.score || !winner.rep.bookingUrl) {
    return { bookingUrl: fallbackUrl, repId: null, score: 0, reasons: [] };
  }
  return {
    bookingUrl: winner.rep.bookingUrl,
    repId: winner.rep.id,
    score: winner.score,
    reasons: winner.reasons,
  };
}
