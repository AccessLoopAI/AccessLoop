// A small, deterministic language guess for reporter text shown back on screen (Phase 7 T4.3): French text gets
// lang="fr" so a screen reader reads it with a French voice (WCAG 3.1.2 Language of Parts). It only ever picks
// between English (the page's language, so it returns undefined) and French. Pure and client-safe; it never sends
// the text anywhere and is never used to decide anything about a case.

const FRENCH = new Set([
  "le", "la", "les", "des", "du", "un", "une", "est", "et", "je", "j'ai", "ne", "pas", "pour", "avec", "dans", "sur",
  "mon", "ma", "mes", "au", "aux", "que", "qui", "il", "elle", "nous", "vous", "ce", "cette", "c'est", "n'est",
  "à", "être", "très", "peux", "peut", "porte", "fauteuil", "roulant", "bouton", "depuis", "semaines", "rue",
  "succursale", "téléphone", "parce", "mais", "ou", "où", "aussi", "quand", "j'", "l'", "d'", "qu'", "n'",
  "suis", "sont", "était", "fonctionne", "marche", "entrer", "accès", "personne", "aide",
]);

const ENGLISH = new Set([
  "the", "and", "is", "to", "of", "in", "it", "my", "i", "for", "with", "at", "can't", "was", "not", "this", "that",
  "button", "door", "have", "has", "be", "but", "when", "can", "cannot", "page", "phone", "branch", "get", "from",
  "there", "they", "we", "you", "your", "me", "so", "does", "doesn't", "don't", "work", "works", "because",
]);

/**
 * "fr" when the text reads as French, otherwise undefined (the page's own English). Needs a few words of evidence:
 * at least 3 French marker words, more than twice as many as English ones. Accented letters count as one extra
 * French marker.
 */
export function detectFrench(text: string): "fr" | undefined {
  const lower = text.toLowerCase().replace(/[‘’]/g, "'");
  const words = lower.match(/[a-zàâçéèêëîïôûùüÿœæ']+/g) ?? [];
  if (words.length < 3) return undefined;
  let fr = 0;
  let en = 0;
  for (const raw of words) {
    // Elisions ("l'entrée", "j'ai") count as their French article or pronoun.
    const w = raw.replace(/^'+|'+$/g, "");
    const elided = w.match(/^([cdjlmnst]|qu)'/);
    if (FRENCH.has(w) || elided) fr++;
    else if (ENGLISH.has(w)) en++;
  }
  if (/[àâçéèêëîïôûùüÿœæ]/.test(lower)) fr++;
  return fr >= 3 && fr > en * 2 ? "fr" : undefined;
}
