import type { Translations } from "./types"

export const fr: Translations = {
  home: {
    title: "NikCLI",
    welcome: "Bienvenue sur NikCLI",
    description: "Votre assistant de programmation basé sur IA",
    startSession: "Démarrer une Session",
    settings: "Paramètres",
  },
  session: {
    title: "Session",
    editorPlaceholder: "Tapez votre code ici...",
    noActiveSession: "Aucune session active",
    createNewSession: "Créez une nouvelle session pour commencer",
  },
  settings: {
    title: "Paramètres",
    appearance: "Apparence",
    editor: "Éditeur",
    theme: "Thème",
    light: "Clair",
    dark: "Sombre",
    system: "Système",
    fontSize: "Taille de Police",
    wordWrap: "Retour à la Ligne",
    showLineNumbers: "Afficher les Numéros de Ligne",
  },
  sidebar: {
    sessions: "Sessions",
    noSessions: "Aucune session",
    newSession: "Nouvelle Session",
  },
  prompt: {
    placeholder: "Demandez n'importe quoi...",
    send: "Envoyer",
    processing: "Traitement...",
    history: "Historique",
    messages: "Messages",
  },
  status: {
    connected: "Connecté",
    disconnected: "Déconnecté",
    sessions: "sessions",
  },
  auth: {
    login: "Connexion",
    logout: "Déconnexion",
  },
  error: {
    title: "Erreur",
    notFound: "Page non trouvée",
    goHome: "Retour à l'Accueil",
  },
}
