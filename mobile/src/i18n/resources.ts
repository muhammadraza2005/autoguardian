import { stitchEn, stitchFr } from './stitchResources';
import { flowEn, flowFr } from './flowResources';
import { devAuthEn, devAuthFr } from './devAuthResources';
import { vehicleEn, vehicleFr } from './vehicleResources';
import { enrollmentEn, enrollmentFr } from './enrollmentResources';
import { evidenceEn, evidenceFr } from './evidenceResources';
import { evidenceReviewEn, evidenceReviewFr } from './evidenceReviewResources';
import { sealEn, sealFr } from './sealResources';
import { sealLocationEn, sealLocationFr } from './sealLocationResources';
import { readinessEn, readinessFr } from './readinessResources';
import { ownerEn, ownerFr } from './ownerResources';
import { wizardEn, wizardFr } from './wizardResources';
export const resources = {
  en: {
    translation: {
      stitch: stitchEn,
      devAuth: devAuthEn,
      ownedVehicles: vehicleEn,
      liveEnrollment: enrollmentEn,
      liveEvidence: evidenceEn,
      evidenceReview: evidenceReviewEn,
      liveSeals: sealEn,
      sealLocations: sealLocationEn,
      liveReadiness: readinessEn,
      liveOwner: ownerEn,
      enrollmentWizard: wizardEn,
      flow: flowEn,
      brand: 'AutoGuardian',
      common: {
        preview: 'Design preview — synthetic data',
        foundation: 'App foundation',
        pending: 'This screen is ready for the frontend implementation.',
        back: 'Back to Check',
        language: 'Language',
        english: 'English',
        french: 'French',
      },
      navigation: {
        check: 'Check', vehicles: 'My vehicles', alerts: 'Alerts', account: 'Account',
        consumer: 'Consumer', agent: 'Enrollment agent',
        institutional: 'Institutional', administration: 'Administration',
        enrollments: 'Enrollments', enrollment: 'New enrollment', stock: 'Seal stock',
      },
      check: {
        title: 'Check a vehicle',
        scanTitle: 'QR scanning unavailable',
        scanUnavailable: 'Camera scanning has not been implemented yet. Return to Check and enter the seal code manually.',
        description: "Check the vehicle, then wait for the owner's confirmation before paying the seller.",
        pending: 'The verification flow will be built here using the revised Stitch HTML and frontend.md.',
      },
      vehicles: { title: 'My vehicles' },
      alerts: { title: 'Alerts' },
      account: {
        title: 'Account',
        previewRole: 'Preview section',
        previewHelp: 'Development fixtures only. These controls do not create real roles or accounts.',
      },
      agent: { title: 'Enrollments', description: 'Drafts remain inactive until the required server checks complete.' },
      enrollment: { title: 'New enrollment' },
      stock: { title: 'Seal stock' },
      institutional: { title: 'Registry counter', description: 'Identity access needs a reason; clearance needs operation-specific consent.' },
      administration: { title: 'Administration', description: 'Management actions must follow the assigned role and organization scope.' },
      access: { title: 'Access unavailable', description: 'This section requires an assigned role and the required authentication.' },
      welcome: {
        title: 'Welcome to AutoGuardian',
        description: 'Phone sign-in and server role loading still need to be connected. Live mode starts here and grants no access.',
      },
    },
  },
  fr: {
    translation: {
      stitch: stitchFr,
      devAuth: devAuthFr,
      ownedVehicles: vehicleFr,
      liveEnrollment: enrollmentFr,
      liveEvidence: evidenceFr,
      evidenceReview: evidenceReviewFr,
      liveSeals: sealFr,
      sealLocations: sealLocationFr,
      liveReadiness: readinessFr,
      liveOwner: ownerFr,
      enrollmentWizard: wizardFr,
      flow: flowFr,
      brand: 'AutoGuardian',
      common: {
        preview: 'Aperçu du design — données fictives',
        foundation: "Base de l'application",
        pending: "Cet écran est prêt pour l'implémentation de l'interface.",
        back: 'Retour à la vérification',
        language: 'Langue',
        english: 'Anglais',
        french: 'Français',
      },
      navigation: {
        check: 'Vérifier', vehicles: 'Mes véhicules', alerts: 'Alertes', account: 'Compte',
        consumer: 'Consommateur', agent: "Agent d'enrôlement",
        institutional: 'Institutionnel', administration: 'Administration',
        enrollments: 'Enrôlements', enrollment: 'Nouvel enrôlement', stock: 'Stock de scellés',
      },
      check: {
        title: 'Vérifier un véhicule',
        scanTitle: 'Lecture QR indisponible',
        scanUnavailable: 'La lecture par caméra reste à implémenter. Revenez à la vérification et saisissez le code du scellé manuellement.',
        description: "Vérifiez le véhicule, puis attendez la confirmation du propriétaire avant de payer le vendeur.",
        pending: 'Le parcours de vérification sera créé ici à partir du HTML Stitch révisé et de frontend.md.',
      },
      vehicles: { title: 'Mes véhicules' },
      alerts: { title: 'Alertes' },
      account: {
        title: 'Compte',
        previewRole: 'Section à prévisualiser',
        previewHelp: "Exemples de développement uniquement. Ces commandes ne créent aucun rôle ni compte réel.",
      },
      agent: { title: 'Enrôlements', description: 'Les brouillons restent inactifs jusqu’à la fin des contrôles requis du serveur.' },
      enrollment: { title: 'Nouvel enrôlement' },
      stock: { title: 'Stock de scellés' },
      institutional: { title: 'Guichet du registre', description: "L'accès à l'identité nécessite un motif ; l'autorisation nécessite le consentement pour cette opération." },
      administration: { title: 'Administration', description: "Les actions doivent respecter le rôle attribué et le périmètre de l'organisation." },
      access: { title: 'Accès indisponible', description: "Cette section nécessite un rôle attribué et l'authentification requise." },
      welcome: {
        title: 'Bienvenue sur AutoGuardian',
        description: "La connexion par téléphone et le chargement des rôles serveur restent à intégrer. Le mode réel commence ici, sans accorder d'accès.",
      },
    },
  },
} as const;
