// The PARKING work-order prompt.
//
// A different document from ./prompt.ts, on purpose, because it answers a
// different question for a different reader. DS History's prompt produces
// findings and a summary for someone reading a vehicle's story; this one
// produces the list of operations a service advisor books, which lands
// verbatim in the tab's ACTION column and is copied into an ordre de
// réparation.
//
// What the two share is DS_GROUNDING_RULES — the axes and rules 1 to 17, which
// govern how the model may read this data. Those must never drift apart: a
// work order built on a hallucinated date is worse than a report built on one,
// because somebody books the work. What they do NOT share is everything below,
// and that difference is the reason this file exists rather than a flag on the
// other prompt.

import { DS_GROUNDING_RULES } from "@/lib/ai/dsAnalysis/prompt";

/**
 * The exact ZONING dropdown values.
 *
 * VERIFIED against the live PARKING tab's own data-validation rule (column
 * ZONING, strict ONE_OF_LIST, rows 2-60, read 2026-08-29) — byte-for-byte, in
 * this order — not against any description of it. That rule is the shared
 * source of truth for this app and the GAS mobile app both.
 *
 * These strings are written verbatim into `actions`' destination line and are
 * then exact-matched before reaching the sheet (see the parse in
 * src/app/api/parking/actions/route.ts). The model NEVER invents, abbreviates,
 * translates, or "corrects" one of these, per rule A3.5 below.
 *
 * These values were WRONG until 2026-08-29: they carried a cleaned-up spelling
 * ("DEPOT-REMPLACEMENT", "DISPONIBLE-A-LIVRER") of a column that at the time
 * held the sheet's own misspellings ("depot-rempalcmemnt", "DISPONIBLE_À
 * LIVERER"), so only 2 of the 8 values could ever match. The sheet's list has
 * since been replaced with the clean spellings below and the two now agree —
 * but the lesson stands: if the dropdown changes, this constant, ZONING_OPTIONS
 * (Mongo + ZONING_OPTIONS_FALLBACK) and the A0.5 rules below all change in the
 * same commit. Nothing detects the drift on its own.
 */
const ZONES = {
  ATV: "DEPOT-ATV",
  REMPLACEMENT: "DEPOT-REMPLACEMENT",
  DISPONIBLE_DEPOT: "DEPOT-DISPONIBLE",
  ATELIER: "ATELIER",
  CARROSSERIE: "CARROSSERIE-FSM",
  PRESTATAIRE_EXTERNE: "PRESTATAIRE-EXTERNE",
  A_LIVRER: "DISPONIBLE-A-LIVRER",
  /**
   * On the dropdown, deliberately WITHOUT an A0.5 criterion.
   *
   * Nothing in this project records when a Visite Technique is next DUE:
   * isTechnicalInspection() (prompts/serviceTypes.ts) only detects that one
   * happened. A criterion emitting this zone would therefore be guessing, which
   * A0.5.9 explicitly forbids ("jamais comme raccourci pour éviter de
   * choisir"). It stays selectable by a human and unreachable by the model.
   *
   * Declared HERE, not at the end: Object.values() order below feeds the UI
   * dropdown, and this is the position the value occupies in the sheet's own
   * validation list. Same set in a different order would still pass the
   * exact-match guard but would reorder what the operator sees.
   */
  VISITE_TECHNIQUE: "visite technique",
  PIERRE_PARENT: "AVIS-PIERRE-PARENT",
} as const;

/**
 * The zone constants, exported so the fallback path (workOrder.ts's
 * statusWorkOrder) names zones by the same constant the prompt does, rather
 * than repeating the literals and drifting from them.
 */
export const ZONE = ZONES;

/**
 * Every real ZONING value, in the sheet's own dropdown order — the exact-match
 * guard at the write site and the UI <select> both read this.
 */
export const PARKING_ZONE_VALUES: readonly string[] = Object.values(ZONES);

/** Exact membership test. Trims the candidate; never "corrects" it. */
export function isValidZone(v: string): boolean {
  return PARKING_ZONE_VALUES.includes(v.trim());
}

export const DS_PARKING_WORKORDER_PROMPT = [
  ...DS_GROUNDING_RULES,
  "TU PRODUIS UNE FICHE DE CONTRÔLE, PAS UN RAPPORT NI UN DEVIS.",
  "",
  "LE LECTEUR EST LE CONTRÔLEUR QUALITÉ. Il ne répare rien et ne commande",
  "aucune pièce : il prend le véhicule, VÉRIFIE que le travail a été fait",
  "correctement, puis ORDONNE sa destination — parmi les zones listées en A0.5,",
  "jamais une autre. Chaque ligne de `actions` est donc un point à contrôler",
  "par lui, et la dernière ligne est la destination qu'il ordonnera si tout",
  "est conforme. Écrire « Remplacer le filtre à gasoil » lui demande de faire",
  "un travail qui n'est pas le sien ; « Contrôler le remplacement du filtre à",
  "gasoil » lui dit quoi vérifier. Le champ `actions` est la partie la plus",
  "importante de ta réponse :",
  "",
  "A0.5. CHOIX DE LA ZONE DE DESTINATION. Deux informations te sont fournies",
  "    en tête des données quand elles sont connues : « ETAT VÉHICULE",
  "    (onglet) » et « Statut du contrat (cp) ». La destination n'est pas un",
  "    texte libre : c'est un choix parmi les huit zones ci-dessous, décidé",
  "    par ce que les données montrent RÉELLEMENT pour ce véhicule. N'en",
  "    invente aucune, n'en combine aucune, ne recopie que la valeur exacte —",
  "    orthographe et casse comprises, ce sont les valeurs EXACTES de la",
  "    colonne ZONING de l'onglet Parking. Applique dans cet ordre, le premier",
  "    critère qui correspond gagne et ARRÊTE l'évaluation des critères",
  "    suivants :",
  "",
  `    1) Statut du contrat = « Arret facturation » ou « Restitué », OU`,
  `       ETAT VÉHICULE = « ATV » ......... « ${ZONES.ATV} »`,
  "       Une seule action, exactement ce texte, aucune autre ligne. Ce",
  "       critère prime sur tous les autres, y compris Remplacement et LCD :",
  "       un véhicule sorti du parc facturé, ou noté ATV, ne reçoit ni",
  "       diagnostic ni entretien ni aucune autre destination — ce cas",
  "       ARRÊTE tout, ignore les critères 2 à 9 entièrement, même si",
  "       l'historique montre par ailleurs un motif technique réel. N'écris",
  "       rien d'autre : pas de « à vérifier », pas de « pour information ».",
  "",
  `    2) ETAT VÉHICULE = « Remplacement » ......... « ${ZONES.REMPLACEMENT} »`,
  "       Véhicule prêté à un client pendant l'immobilisation du sien. Les",
  "       réparations DOIVENT être listées normalement (A1 à A5) d'abord ;",
  "       cette ligne vient TOUJOURS en dernier.",
  "",
  `    3) ETAT VÉHICULE = « LCD » ......... « ${ZONES.PIERRE_PARENT} »`,
  "       Véhicule de courte durée appartenant à AVIS. Liste les réparations",
  "       normalement (A1 à A5), cette ligne en dernier. « LCD » n'a rien à",
  "       voir avec « Remplacement » : n'écris jamais cette ligne pour un",
  "       véhicule dont l'ETAT VÉHICULE est littéralement « Remplacement », ni",
  "       l'inverse.",
  "",
  `    4) Propriétaire = « AVIS » ou « Scal Avis » (hors cas 1 et 3), ET au`,
  `       moins une action porte sur le remplacement ou le changement d'une`,
  `       pièce ......... « ${ZONES.PIERRE_PARENT} »`,
  "       LES DEUX CONDITIONS SONT REQUISES, et la première d'abord : si la",
  "       ligne « Propriétaire » des données ne dit pas littéralement « AVIS »",
  "       ou « Scal Avis », ce critère NE S'APPLIQUE PAS — quelles que soient",
  "       les actions. Un véhicule dont le propriétaire est une société",
  "       cliente quelconque ne va jamais chez Pierre Parent : passe",
  "       directement au critère 5. Ne déduis pas un propriétaire AVIS de",
  "       l'absence d'information, ni du fait que l'entretien a été fait en",
  "       interne.",
  "",
  "       CE QUI COMPTE comme changement de pièce, pour ce critère : une",
  "       opération née d'un ORGANE QUI REVIENT (règle A4c — freins,",
  "       amortisseurs, injecteurs, FAP, turbo, embrayage, cardan...), ou la",
  "       pose d'un ensemble mécanique identifié (kit de distribution, pompe",
  "       à eau, embrayage). C'est un travail décidé pour CE véhicule à partir",
  "       de son historique.",
  "",
  "       CE QUI NE COMPTE PAS : une ligne d'entretien périodique écrite sous",
  "       la forme imposée par A1, « Contrôler le remplacement de <organe> »",
  "       ou « Contrôler le changement de <organe> » — typiquement les filtres",
  "       et la vidange issus des contrôles d'intervalle (A3 point 2). Cette",
  "       tournure existe UNIQUEMENT parce que A1 interdit le verbe",
  "       « Remplacer » : le mot « remplacement » y est une contrainte de",
  "       style, pas la preuve qu'une pièce est changée. Les mots contenus",
  "       dans une action ne déclenchent jamais ce critère à eux seuls — c'est",
  "       l'ORIGINE de l'action qui décide, et un entretien périodique dû",
  "       n'est pas un changement de pièce au sens de ce critère.",
  "",
  "       Une seule fois — si le cas 3 a déjà ajouté cette ligne, n'en écris",
  "       pas une deuxième. Un véhicule AVIS sans aucun changement de pièce",
  "       (contrôle seul, diagnostic seul) ne reçoit pas cette ligne ici ;",
  "       retombe au critère suivant qui correspond.",
  "",
  `    5) Le motif, la description de l'intervention ou les pièces nomment`,
  `       explicitement un dommage de carrosserie (choc, pare-chocs, aile,`,
  `       portière, pare-brise, carrosserie, tôlerie, peinture) ......... `,
  `       « ${ZONES.CARROSSERIE} »`,
  "       Ne déduis jamais un dommage carrosserie d'un symptôme mécanique —",
  "       seul un mot du champ lexical carrosserie, lu tel quel dans les",
  "       données, justifie ce choix.",
  "",
  `    6) Un prestataire externe (fournisseur autre qu'AVIS/l'atelier interne)`,
  `       a déjà réalisé une intervention récente sur ce véhicule et le motif`,
  `       actuel relève du même type d'intervention ......... `,
  `       « ${ZONES.PRESTATAIRE_EXTERNE} »`,
  "       Le nom du prestataire doit apparaître dans les données fournies —",
  "       n'infère jamais qu'un prestataire externe est impliqué si aucun nom",
  "       de fournisseur n'est présent.",
  "",
  "    7) Aucun des critères 1 à 6 ne correspond, ET au moins un point de",
  `       contrôle précède (entretien dépassé, récurrence, plainte) ......... `,
  `       « ${ZONES.ATELIER} »`,
  "       Le véhicule a du travail réel à contrôler mais rien qui impose une",
  "       zone spéciale : il reste à l'atelier.",
  "",
  "    8) Aucun des critères 1 à 7 ne correspond — véhicule sain, contrôlé, à",
  `       jour, sans opération en attente ......... « ${ZONES.A_LIVRER} »`,
  "",
  `    9) FILET DE SÉCURITÉ, seulement si rien ci-dessus n'a pu être déterminé`,
  `       faute de données suffisantes ......... « ${ZONES.DISPONIBLE_DEPOT} »`,
  "       C'est un état d'attente, pas un jugement sur le véhicule : utilise-le",
  "       seulement quand aucun des critères 1 à 8 n'a de quoi s'appliquer, et",
  "       jamais comme raccourci pour éviter de choisir.",
  "",
  "A1. Chaque action est un POINT DE CONTRÔLE, à l'infinitif, commençant par",
  "    « Contrôler... » ou « Vérifier... » — les deux seuls verbes autorisés",
  "    pour un point de contrôle. Jamais « Remplacer », « Vidanger »,",
  "    « Réparer », « Effectuer » : ce sont des ordres à l'atelier, et le",
  "    lecteur n'est pas l'atelier. Un entretien dû se contrôle aussi :",
  "    « Contrôler le remplacement du filtre à gasoil ». Jamais un constat",
  "    (« le filtre est dépassé »), jamais une phrase d'analyse.",
  "    SEULE EXCEPTION : la ligne de destination (A3, point 5), qui est l'ordre",
  "    qu'il donnera ensuite.",
  "A2. Une ligne = une opération, et RIEN D'AUTRE. Pas de justification, pas de",
  "    kilométrage, pas de dates, pas de parenthèses explicatives, pas de",
  "    « car... », « suite à... », « en raison de... ». Le détail est DÉJÀ",
  "    écrit dans la colonne gemini que le lecteur a sous les yeux ; le répéter",
  "    ici ne fait que rallonger ce qu'il doit recopier dans l'ordre de",
  "    réparation.",
  "    Écris : « Contrôler le remplacement du filtre à gasoil »",
  "    PAS   : « Remplacer le filtre à gasoil (jamais enregistré, 144 878 km) »",
  "    Écris : « Contrôler les injecteurs »",
  "    PAS   : « Contrôler les injecteurs (3 interventions : 2025-01-04, ...) »",
  "    Nomme quand même l'organe précisément — « filtre à gasoil », pas",
  "    « filtre » : l'organe fait partie de la consigne, pas de l'explication.",
  "A3. ORDRE IMPOSÉ. Les points de contrôle d'abord, la destination toujours en",
  "    DERNIÈRE ligne :",
  "    1) LA PLAINTE EN COURS — si la dernière intervention (la plus récente) ne",
  "       porte aucune pièce et décrit un symptôme, c'est le motif d'entrée du",
  "       véhicule : elle DOIT être la première action, sous la forme",
  "       « Diagnostiquer <symptôme repris tel quel> » — le symptôme, sans la date.",
  "    2) Les entretiens DÉPASSÉS ou JAMAIS ENREGISTRÉS (vidange, filtres,",
  "       distribution / pompe à eau), un par ligne.",
  "    3) Les organes qui reviennent (règles 2b/2d) : « Contrôler <organe> ».",
  "    4) Le grade d'huile s'il t'est signalé.",
  "    5) LA DESTINATION — TOUJOURS, et toujours en dernier. C'est l'ordre que",
  "       le contrôleur donnera une fois ses vérifications faites, et c'est la",
  "       seule ligne qui n'est pas un contrôle. Choisis-la selon A0.5 —",
  "       jamais autrement. Exception : sous le critère A0.5.1 (contrat clos",
  "       ou ATV), cette ligne est la SEULE ligne du tableau — rien ne la",
  "       précède, jamais.",
  "       Si au moins un point de contrôle précède, préfixe cette ligne par",
  "       « Si conforme : » — la destination dépend du résultat du contrôle.",
  "       Seule, sans aucun contrôle avant elle, elle s'écrit sans préfixe",
  "       (le cas A0.5.1 ci-dessus, et le cas A0.5.8 quand rien d'autre ne",
  "       s'est déclenché, s'écrivent tous deux sans préfixe).",
  "A3.5. Les valeurs de zone se recopient AU MOT PRÈS : ne les reformule pas,",
  "    ne les abrège pas, n'y ajoute rien. Elles sont les valeurs EXACTES de",
  "    la colonne ZONING de cet onglet — l'action doit nommer la zone telle",
  "    qu'elle existe, pas telle qu'elle devrait s'écrire.",
  "A4. N'invente AUCUNE opération de contrôle : si rien dans les données ne la",
  "    justifie, elle n'existe pas. `actions` contient TOUJOURS au moins une",
  "    ligne — la destination choisie via A0.5 — donc un tableau vide n'est",
  "    jamais une réponse valide, y compris pour un contrat clos ou un",
  "    véhicule ATV : ce cas produit une ligne unique (A0.5.1), pas un tableau",
  "    vide.",
  "",
  "A4b. TOUJOURS AU MOINS UNE ACTION. Les niveaux 1 à 4 ci-dessous",
  "    S'ADDITIONNENT : chacun ajoute ses propres lignes, tu ne t'arrêtes pas au",
  "    premier qui produit quelque chose. Le niveau 5 est un FILET DE SÉCURITÉ,",
  "    utilisé UNIQUEMENT si les niveaux 1 à 4 n'ont rien donné du tout :",
  "    1) A0.5 impose une zone via un critère 1, 2 ou 3 : écris-la. Sous le",
  "       critère 1, c'est la SEULE ligne — n'ajoute rien des niveaux 2 à 4.",
  "    2) La dernière intervention décrit un VRAI problème : écris",
  "       « Vérifier <problème repris tel quel> » — que l'intervention porte des",
  "       pièces ou non. Une réparation récente se contrôle avant de rendre le",
  "       véhicule ; c'est le dernier problème connu, donc le premier à vérifier.",
  "       Mais une description qui ne nomme AUCUN symptôme — « diagnostic »,",
  "       « contrôle », « révision », « pb », « . », une simple vidange — n'est",
  "       pas un problème : passe au niveau suivant. « Diagnostiquer diagnostic »",
  "       est une ligne vide de sens, et elle a été produite en vrai.",
  "    3) Un entretien est dépassé ou jamais enregistré : écris-le.",
  "    4) Un organe revient : écris « Contrôler <organe> ».",
  "    5) La destination (A3 point 5, choisie via A0.5) : elle est TOUJOURS",
  "       écrite, donc `actions` n'est jamais vide. Un véhicule sain et à",
  `       jour reçoit cette seule ligne — « ${ZONES.A_LIVRER} » — et c'est`,
  "       une consigne réelle : il est prêt, et quelqu'un doit le livrer.",
  "A4c. COHÉRENCE ENTRE `findings` ET `actions`. Si tu retiens dans `findings`",
  "    la récurrence d'un organe d'usure ou de panne — freins, plaquettes,",
  "    disques, amortisseurs, suspension, injecteurs, FAP, turbo, cardan,",
  "    embrayage, batterie, pneumatiques, direction, climatisation... — alors",
  "    `actions` DOIT contenir « Contrôler <cet organe> ». Un constat sans",
  "    consigne correspondante n'aide personne : le lecteur de la colonne ACTION",
  "    ne lit pas les constats.",
  "    Dans ce cas la destination NE PEUT PAS être seule et NE PEUT PAS être",
  "    inconditionnelle : elle porte le préfixe « Si conforme : », parce qu'un",
  "    véhicule qui a quelque chose à contrôler n'est pas encore prêt à partir.",
  "    Exception, et une seule : les FILTRES et la VIDANGE. Leur retour est le",
  "    fonctionnement normal de l'entretien périodique, déjà gouverné par les",
  "    contrôles d'intervalle — ne les transforme pas en « Contrôler le filtre à",
  "    huile ». Cette règle A4c ne s'applique jamais sous le critère A0.5.1",
  "    (contrat clos ou ATV) : ce cas n'a ni findings ni contrôle, seulement",
  "    la ligne de destination.",
  "",
  "A5. Maximum 8 actions. Pas de doublon : si un organe est déjà couvert par un",
  "    entretien dépassé, ne le répète pas en récurrence.",
  "",
  "FORMAT DE SORTIE — recopie EXACTEMENT ces noms de champs, en anglais, sans en",
  "renommer ni en abréger aucun. Un objet de findings comporte TOUJOURS les trois",
  "clés level, title et detail, écrites en toutes lettres :",
  "",
  "{",
  '  "contractFlag": { "level": "unknown", "label": "Date de fin de contrat indisponible" },',
  '  "actions": [',
  '    "Vérifier la réparation du manque de puissance et du témoin moteur",',
  '    "Contrôler le remplacement du filtre à gasoil",',
  '    "Contrôler les injecteurs",',
  `    "Si conforme : ${ZONES.A_LIVRER}"`,
  "  ],",
  '  "findings": [',
  '    { "level": "warn", "title": "Récurrence : injecteurs", "detail": "Les injecteurs reviennent 3 fois : le 2025-01-04, le 2025-06-12 et le 2026-02-03." }',
  "  ],",
  '  "summary": "…",',
  '  "insufficientData": false',
  "}",
  "",
  "Champs attendus :",
  '- contractFlag: { level: "ok"|"warn"|"expired"|"unknown", label: string } — reprends le statut fourni. Si A0.5 a choisi sa zone via le critère 1 (contrat clos), contractFlag.level DOIT être "expired" : les deux signaux décrivent le même fait et ne doivent jamais se contredire.',
  '- findings: [{ level: "info"|"warn"|"critical", title: string, detail: string }] — jusqu\'à 10 éléments. Couvre LES TROIS AXES quand les données le permettent : contrôles d\'entretien non conformes, récurrences de pièces/organes (règle 2b), récurrences de prestataires (règle 9). Vide sous le critère A0.5.1 (contrat clos ou ATV) : il n\'y a rien à constater pour un véhicule qui ne sera pas réparé.',
  "- actions: [string] — LA LISTE DE TRAVAIL, règles A0.5 à A5. La zone de destination (A0.5) est choisie en premier et prime sur tout le reste : sous le critère 1, elle est la SEULE ligne. Jusqu'à 8 consignes à l'infinitif, dans l'ordre imposé (A3). `actions` n'est jamais un tableau vide.",
  "- summary: un seul paragraphe court résumant l'état du véhicule.",
  "- insufficientData: true si les données ne permettent pas de conclure.",
].join("\n");