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
 * The exact ZONING dropdown values, in sync with CFG_PARKING_SHEET.ZONING_OPTIONS
 * in the Parking Apps Script config, and with the live Sheet's column E data
 * validation (verified byte-identical as of the last sync). These strings are
 * written verbatim into `actions`' destination line and MUST match a pre-existing
 * ZONING cell's value exactly when reading it back — the model NEVER invents,
 * abbreviates, translates, or "corrects" one of these. If the dropdown list in
 * the Sheet ever changes, this constant must change in the same commit.
 */
const ZONES = {
  ATV: "DEPOT-ATV",
  REMPLACEMENT: "DEPOT-REMPLACEMENT",
  DISPONIBLE_DEPOT: "DEPOT-DISPONIBLE",
  ATELIER: "ATELIER",
  CARROSSERIE: "CARROSSERIE-FSM",
  PRESTATAIRE_EXTERNE: "PRESTATAIRE-EXTERNE",
  A_LIVRER: "DISPONIBLE-A-LIVRER",
  VISITE_TECHNIQUE: "visite technique",
  PIERRE_PARENT: "AVIS-PIERRE-PARENT",
} as const;

export const ZONE = ZONES;

/**
 * The zones A0.0 short-circuits on: a value already in the ZONING cell is
 * trusted and the model produces only the fixed routing line.
 *
 * THE list — A0.0's prompt text says "une des cinq valeurs suivantes" and this
 * must stay those exact five. Consumers that need to know whether a zone is
 * fixed-routing (zonePreconditionFailure's A0.0 bypass, the ZONING route's
 * re-analysis trigger) import this instead of rebuilding the array, which is
 * how the prompt and the code drift apart.
 *
 * NOTE the other four zones are deliberately absent: DEPOT-DISPONIBLE,
 * DISPONIBLE-A-LIVRER and AVIS-PIERRE-PARENT are named in A0.0 as explicitly
 * NOT fixed (the full analysis decides them), and DEPOT-REMPLACEMENT is named
 * in neither clause — an acknowledged hole in the rule text, not an omission
 * here. A0.5.2 happens to route those rows correctly off ETAT anyway.
 */
export const A00_FIXED_ROUTING_ZONES: readonly string[] = [
  ZONES.ATV,
  ZONES.ATELIER,
  ZONES.CARROSSERIE,
  ZONES.PRESTATAIRE_EXTERNE,
  ZONES.VISITE_TECHNIQUE,
];

/** True when ZONING already fixes the destination — see A00_FIXED_ROUTING_ZONES. */
export function isFixedRoutingZone(zoning: string): boolean {
  return A00_FIXED_ROUTING_ZONES.includes(zoning.trim());
}
export const PARKING_ZONE_VALUES: readonly string[] = Object.values(ZONES);

// NOTE: This code-side check against PARKING_ZONE_VALUES is the sole safety net for ZONING writes; strict:true validation is unenforced server-side in Google Sheets API.
export function isValidZone(value: string): boolean {
  return PARKING_ZONE_VALUES.includes(value);
}

/**
 * ATELIER's suppression sentence, reused verbatim for the other fixed-routing
 * branches of A0.0.
 *
 * Measured 2026-08-30: with only the destination stated, the model read ZONING
 * correctly but would not stop analysing — 39360-B-7 and 25044-T-6 both ran a
 * full checklist 8/8 on a ZONING already set to «visite technique», while
 * 46540-B-7 complied 8/8. Per-vehicle deterministic, and the failures were the
 * vehicles with the most history: abundant checklist material outcompetes a
 * short-circuit that never says "add nothing". ATELIER was the one branch that
 * said it, so its wording is what the others now get.
 */
function noAnalysisNote(zone: string): string[] {
  return [
    "        Une seule ligne, ce texte exact. N'ajoute aucun point de contrôle,",
    `        aucun entretien dépassé, aucune récurrence : la zone « ${zone} »`,
    "        déjà posée signifie que le véhicule y va directement, sans liste",
    "        de vérifications préalables.",
  ];
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
  // A0.0 is a deliberate shortcut, not a default: for the five zones listed
  // below, a ZONING value already in the cell is trusted as-is and the model
  // produces only the fixed routing line — a human or an earlier process
  // already decided, so re-deriving it through A0.5 could only disagree. It
  // fires ONLY when ZONING is non-empty; an empty cell always gets the full
  // A0.5-to-A5 analysis. The rule lives in this prompt text, not in code —
  // there is no zone Set to keep in sync, so edit the branches below.
  "A0.0. LA COLONNE ZONING PEUT DÉJÀ CONTENIR UNE VALEUR. Regarde-la avant",
  "    toute analyse. Si elle est vide, ignore cette règle entièrement et",
  "    passe directement à A0.5. Si elle contient déjà une des cinq valeurs",
  "    suivantes, N'ANALYSE PAS le véhicule via A0.5 à A5 : produis",
  "    uniquement la ligne de routage indiquée, sans contrôle, sans",
  "    findings, sans recherche de récurrence. La valeur déjà présente prime",
  "    sur tout ce que l'historique pourrait suggérer — un humain ou un",
  "    processus antérieur a déjà tranché.",
  "",
  `    ZONING = « ${ZONES.CARROSSERIE} »`,
  `        actions = [ « Envoyer vers ${ZONES.CARROSSERIE} » ]`,
  ...noAnalysisNote(ZONES.CARROSSERIE),
  "",
  `    ZONING = « ${ZONES.PRESTATAIRE_EXTERNE} »`,
  `        actions = [ « Envoyer vers ${ZONES.PRESTATAIRE_EXTERNE}<NOM> » ]`,
  "        <NOM> : cherche le nom du prestataire dans la colonne BDD fournie.",
  "        S'il est lisible tel quel, ajoute-le entre parenthèses :",
  `        « Envoyer vers ${ZONES.PRESTATAIRE_EXTERNE} (Garage XYZ) ». S'il`,
  "        n'apparaît nulle part dans BDD, ou si BDD est vide ou illisible,",
  "        N'INVENTE AUCUN NOM — écris la ligne sans parenthèse. Un nom",
  "        déduit d'une supposition plutôt que lu dans BDD est exactement le",
  "        type d'invention que les règles de grounding interdisent.",
  ...noAnalysisNote(ZONES.PRESTATAIRE_EXTERNE),
  "",
  `    ZONING = « ${ZONES.ATV} »`,
  `        actions = [ « Envoyer vers ${ZONES.ATV} » ]`,
  ...noAnalysisNote(ZONES.ATV),
  "",
  `    ZONING = « ${ZONES.VISITE_TECHNIQUE} »`,
  `        actions = [ « Envoyer vers ${ZONES.VISITE_TECHNIQUE} » ]`,
  ...noAnalysisNote(ZONES.VISITE_TECHNIQUE),
  "",
  `    ZONING = « ${ZONES.ATELIER} »`,
  '        actions = [ « Merci de créer le DS et faire entrer à l\'atelier » ]',
  "        Une seule ligne, ce texte exact. N'ajoute aucun point de contrôle,",
  "        aucun entretien dépassé, aucune récurrence : la zone ATELIER déjà",
  "        posée signifie que le véhicule y entre directement, sans liste de",
  "        vérifications préalables.",
  "",
  "    Pour ces cinq cas, `findings` est un tableau vide et `summary` se",
  "    limite à une phrase constatant que la zone était déjà fixée — ne",
  "    résume pas l'historique du véhicule, ce travail n'a pas été fait.",
  "",
  "    Si ZONING contient une des TROIS AUTRES valeurs — DEPOT-DISPONIBLE,",
  "    DISPONIBLE-A-LIVRER, ou AVIS-PIERRE-PARENT — ceci ne s'applique pas :",
  "    poursuis l'analyse normale via A0.5 à A5 ci-dessous, comme si ZONING",
  "    était vide. Ces trois zones ne sont pas des routages fixes ; elles",
  "    dépendent de ce que l'analyse complète trouve.",
  "",
  "A0.5. CHOIX DE LA ZONE DE DESTINATION. Ne s'applique QUE si A0.0",
  "    ci-dessus ne s'est pas déjà déclenché — c'est-à-dire ZONING vide, ou",
  "    ZONING déjà sur une des trois zones non-fixes. Deux informations te",
  "    sont fournies en tête des données quand elles sont connues : « ETAT",
  "    VÉHICULE (onglet) » et « Statut du contrat (cp) ». La destination",
  "    n'est pas un texte libre : c'est un choix parmi les zones ci-dessous,",
  "    décidé par ce que les données montrent RÉELLEMENT pour ce véhicule.",
  "    N'en invente aucune, n'en combine aucune, ne recopie que la valeur",
  "    exacte — orthographe et casse comprises, ce sont les valeurs EXACTES",
  "    de la colonne ZONING de cet onglet. Applique dans cet ordre, le",
  "    premier critère qui correspond gagne et ARRÊTE l'évaluation des",
  "    critères suivants :",
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
  "       Une seule fois — si le cas 3 a déjà ajouté cette ligne, n'en écris",
  "       pas une deuxième. Un véhicule AVIS sans aucun changement de pièce",
  "       (contrôle seul, diagnostic seul) ne reçoit pas cette ligne ici ;",
  "       retombe au critère suivant qui correspond.",
  "       ATTENTION — piège déjà rencontré : une ligne de la forme",
  "       « Contrôler le remplacement de <organe> » ou « Contrôler le",
  "       changement de <organe> » — c'est-à-dire suivant la formulation",
  "       imposée par la règle A1 pour un entretien périodique dû — NE",
  "       COMPTE PAS comme une action de remplacement pour ce critère,",
  "       quels que soient les mots qu'elle contient. Seule une vraie pièce",
  "       changée, identifiée via un entretien dépassé (A3 point 2) ou une",
  "       récurrence d'organe (A4c), compte ici.",
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
  "    SEULE EXCEPTION : la ligne de destination (A3, point 5), et les lignes",
  "    de routage fixe produites sous A0.0.",
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
  "    EXCEPTION explicitement autorisée : la parenthèse « (NOM) » sur la",
  "    ligne de routage prestataire externe sous A0.0, qui n'est pas une",
  "    justification mais une identité déduite de BDD.",
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
  "       jamais autrement. Cette règle A3 ne s'applique pas aux cinq cas de",
  "       routage fixe sous A0.0, qui n'ont qu'une seule ligne par",
  "       construction.",
  "       Si au moins un point de contrôle précède, préfixe cette ligne par",
  "       « Si conforme : » — la destination dépend du résultat du contrôle.",
  "       Seule, sans aucun contrôle avant elle, elle s'écrit sans préfixe.",
  "A3.5. Les valeurs de zone se recopient AU MOT PRÈS : ne les reformule pas,",
  "    ne les abrège pas, n'y ajoute rien. Elles sont les valeurs EXACTES de",
  "    la colonne ZONING de cet onglet — l'action doit nommer la zone telle",
  "    qu'elle existe, pas telle qu'elle devrait s'écrire.",
  "A4. N'invente AUCUNE opération de contrôle : si rien dans les données ne la",
  "    justifie, elle n'existe pas. `actions` contient TOUJOURS au moins une",
  "    ligne, donc un tableau vide n'est jamais une réponse valide.",
  "",
  "A4b. TOUJOURS AU MOINS UNE ACTION. Ne s'applique QUE si A0.0 ne s'est pas",
  "    déjà déclenché. Les niveaux 1 à 4 ci-dessous S'ADDITIONNENT : chacun",
  "    ajoute ses propres lignes, tu ne t'arrêtes pas au premier qui produit",
  "    quelque chose. Le niveau 5 est un FILET DE SÉCURITÉ, utilisé",
  "    UNIQUEMENT si les niveaux 1 à 4 n'ont rien donné du tout :",
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
  "A4c. COHÉRENCE ENTRE `findings` ET `actions`. Ne s'applique pas sous A0.0.",
  "    Si tu retiens dans `findings` la récurrence d'un organe d'usure ou de",
  "    panne — freins, plaquettes, disques, amortisseurs, suspension,",
  "    injecteurs, FAP, turbo, cardan, embrayage, batterie, pneumatiques,",
  "    direction, climatisation... — alors `actions` DOIT contenir",
  "    « Contrôler <cet organe> ». Un constat sans consigne correspondante",
  "    n'aide personne : le lecteur de la colonne ACTION ne lit pas les",
  "    constats.",
  "    Dans ce cas la destination NE PEUT PAS être seule et NE PEUT PAS être",
  "    inconditionnelle : elle porte le préfixe « Si conforme : », parce qu'un",
  "    véhicule qui a quelque chose à contrôler n'est pas encore prêt à partir.",
  "    Exception, et une seule : les FILTRES et la VIDANGE. Leur retour est le",
  "    fonctionnement normal de l'entretien périodique, déjà gouverné par les",
  "    contrôles d'intervalle — ne les transforme pas en « Contrôler le filtre à",
  "    huile ».",
  "",
  "A5. Maximum 8 actions. Ne s'applique pas sous A0.0 (une seule ligne par",
  "    construction). Pas de doublon : si un organe est déjà covered par un",
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
  "Exemple de sortie pour un routage fixe déjà déterminé (A0.0, ZONING",
  `déjà = « ${ZONES.CARROSSERIE} ») :`,
  "",
  "{",
  '  "contractFlag": { "level": "unknown", "label": "Date de fin de contrat indisponible" },',
  `  "actions": [ "Envoyer vers ${ZONES.CARROSSERIE}" ],`,
  '  "findings": [],',
  '  "summary": "Zone déjà déterminée : carrosserie.",',
  '  "insufficientData": false',
  "}",
  "",
  "Champs attendus :",
  '- contractFlag: { level: "ok"|"warn"|"expired"|"unknown", label: string } — reprends le statut fourni. Si A0.5 a choisi sa zone via le critère 1 (contrat clos), contractFlag.level DOIT être "expired" : les deux signaux décrivent le même fait et ne doivent jamais se contredire.',
  '- findings: [{ level: "info"|"warn"|"critical", title: string, detail: string }] — jusqu\'à 10 éléments. Couvre LES TROIS AXES quand les données le permettent : contrôles d\'entretien non conformes, récurrences de pièces/organes (règle 2b), récurrences de prestataires (règle 9). Tableau vide sous A0.0 (routage fixe) : il n\'y a rien à constater pour un véhicule dont la zone est déjà fixée.',
  "- actions: [string] — LA LISTE DE TRAVAIL. Vérifie D'ABORD A0.0 (zone déjà fixée dans ZONING) avant toute autre règle ; si elle s'applique, une seule ligne de routage suffit et rien d'autre ne s'exécute. Sinon, règles A0.5 à A5 s'appliquent normalement. `actions` n'est jamais un tableau vide.",
  "- summary: un seul paragraphe court résumant l'état du véhicule, ou une phrase constatant la zone déjà fixée sous A0.0.",
  "- insufficientData: true si les données ne permettent pas de conclure.",
].join("\n");