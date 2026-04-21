export interface SuiviDraft {
  _id?: string;
  IMM: string;
  date: string;
  client: string;
  modele: string;
  ETAT: string;
  prestataire: string;
  commentaire: string;
  flag: string;
  "Reunion N-1": string;
  date_ds: string;
  ds: string;
  mois_restant: string;
  date_fin_contrat: string;
  lieu_Reparation: string;
  Motif: string;
  station_depart: string;
  createdAt?: string;
  updatedAt?: string;
}

export const ETAT_OPTIONS = [
  "EN COURS",
  "EN ATTENTE",
  "PRET",
  "ANNULEE",
  "SORTI",
];

export const SUIVI_FIELDS: { key: keyof SuiviDraft; label: string; required?: boolean }[] = [
  { key: "IMM",             label: "IMM",              required: true },
  { key: "date",            label: "Date",             required: true },
  { key: "client",          label: "Client" },
  { key: "modele",          label: "Modèle" },
  { key: "ETAT",            label: "État",             required: true },
  { key: "prestataire",     label: "Prestataire" },
  { key: "commentaire",     label: "Commentaire" },
  { key: "flag",            label: "Flag" },
  { key: "Reunion N-1",     label: "Réunion N-1" },
  { key: "date_ds",         label: "Date DS" },
  { key: "ds",              label: "DS" },
  { key: "mois_restant",    label: "Mois restant" },
  { key: "date_fin_contrat",label: "Date fin contrat" },
  { key: "lieu_Reparation", label: "Lieu réparation" },
  { key: "Motif",           label: "Motif" },
  { key: "station_depart",  label: "Station départ" },
];