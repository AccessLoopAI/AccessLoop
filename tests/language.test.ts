// lib/intake/language.ts (Phase 7 T4.3): French reporter text is marked lang="fr" on screen (WCAG 3.1.2).
import { describe, expect, it } from "vitest";
import { detectFrench } from "@/lib/intake/language";

describe("detectFrench", () => {
  it("finds French reports, with or without accents", () => {
    expect(detectFrench("Le bouton de la porte automatique est brisé depuis trois semaines, je ne peux pas entrer.")).toBe("fr");
    expect(detectFrench("Je ne peux pas utiliser le site avec mon lecteur d'écran.")).toBe("fr");
    expect(detectFrench("le bouton de la porte ne marche pas avec mon fauteuil roulant")).toBe("fr");
    expect(detectFrench("Il n’y a pas de rampe à l’entrée de la succursale.")).toBe("fr");
  });

  it("leaves English (the page's language) and short or mixed text alone", () => {
    expect(detectFrench("The automatic door button at the King Street branch has been broken for three weeks.")).toBeUndefined();
    expect(detectFrench("I can't pick a date on the booking page with my keyboard.")).toBeUndefined();
    expect(detectFrench("Rue Sainte-Catherine")).toBeUndefined();
    expect(detectFrench("")).toBeUndefined();
    expect(detectFrench("The door at the Café du Monde on rue Principale is too heavy for my chair.")).toBeUndefined();
  });
});
