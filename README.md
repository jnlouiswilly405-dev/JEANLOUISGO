# JEANLOUISGO — Backend V45 (branche de récupération)

Branche : `recovery/v45-source-restore`. Ce dépôt contient le backend V45 restauré. **Il n'est pas prêt pour la production.**

## État réel

| Élément | État |
|---|---|
| Backend TypeScript (Express 5, PostgreSQL) | Restauré et fonctionnel |
| Migrations PostgreSQL 006–017 + `database/schema.sql` | Appliquées en CI sur PostgreSQL 16 |
| Dépendances | `package-lock.json` validé ; installation reproductible avec `npm ci` |
| CI (`.github/workflows/ci-postgres.yml`) | Node 22 : `npm ci`, schéma, migrations, QA statique, build, tests unitaires, tests d'intégration PostgreSQL |
| Tests unitaires (`npm test`) | Vitest, sans base de données |
| Tests d'intégration (`npm run test:int`) | Vitest sur PostgreSQL 16 (`backend/integration/*.int.ts`) ; refusent de s'exécuter si le nom de la base ne se termine pas par `_test` |
| Lint / typage (`npm run lint`) | `tsc --noEmit` |

Le statut officiel et à jour de la CI est celui de GitHub Actions pour le dernier commit de la branche ; ce fichier ne le fige pas.

## Modules backend

Authentification, commandes, paiements, dispatch, livreurs, commerçants, catalogue, suivi, livraison, chat, notifications, avis, promotions, règlements (settlements) et administration.

### Outbox des règlements

- Le worker (`backend/src/modules/settlements/outbox-runner.ts`) est **désactivé par défaut**. Il ne démarre que si `OUTBOX_WORKER_ENABLED=true`. Arrêt propre sur SIGTERM/SIGINT.
- Son gestionnaire est **fail-closed** : tout événement `SETTLEMENT_REQUESTED` valide se termine en échec `PAYOUT_PROVIDER_CONFIRMATION_REQUIRED` puis `BLOCKED` après le nombre maximal de tentatives. Aucun gain, écriture de grand livre, règlement ou paiement n'est créé, et rien n'est marqué `PAID`.
- Un événement `PROCESSING` dont le bail a expiré et dont les tentatives sont épuisées passe en `BLOCKED` au lieu d'être repris indéfiniment.
- Visibilité administrateur en lecture seule : `GET /api/admin/outbox/blocked` (rôle `ADMIN`). Filtres : `eventType`, `aggregateId` ; pagination : `limit` (1–100, défaut 50) et `offset`. Le contenu (`payload`), le jeton de bail et la clé de dédoublonnage ne sont jamais exposés, et la raison d'échec est assainie.

## Démarrage local

```bash
npm ci
npm run build
npm test
# PostgreSQL 16 requis pour les tests d'intégration (base dont le nom se termine par _test) :
DATABASE_URL=postgres://user:pass@localhost:5432/xxx_test npm run test:int
bash tests/final/static-qa.sh
bash -n database/migrate.sh
```

Voir `.env.example` pour les variables d'environnement.

## Frontends

`apps/customer`, `apps/driver`, `apps/merchant` et `apps/admin` ne contiennent que des README de substitution : **les sources frontend sont manquantes**.

## Sécurité — paiements

- Stripe fonctionne uniquement en **mode test (sandbox)** : désactivé par défaut, activé seulement avec `STRIPE_SECRET_KEY` (`sk_test_...`) et `STRIPE_WEBHOOK_SECRET` ; les clés live sont refusées. Webhook signé sur corps brut : `POST /api/payments/webhook/stripe`. Les paiements réels, remboursements applicatifs, Stripe Connect et versements (payouts) restent **désactivés**.
- La politique financière des règlements n'est pas décidée (`docs/SETTLEMENT_FINANCIAL_POLICY_GATE.md`) ; la création réelle de règlements reste bloquée.
- Ne pas déployer en production avant décision explicite.

## Points bloquants restants

1. Politique financière des règlements/versements non décidée.
2. Stripe : sandbox uniquement ; pas de paiements réels, de remboursements applicatifs, de Connect ni de versements.
3. Sources frontend manquantes.
4. Vérification octet par octet de la restauration impossible : l'archive ZIP d'origine ou l'export texte original est nécessaire. Cette vérification n'est **pas** terminée.
5. Avertissement du script d'installation d'esbuild non traité (aucun changement `allowScripts`).

## Documentation

Voir `docs/` (audits, portes de validation des paiements, politique de règlement, rapports de validation V45). En particulier : `docs/STRIPE_IMPLEMENTATION_PLAN.md` (état du sandbox et plan), `docs/SETTLEMENT_POLICY_PROPOSAL.md` (proposition de politique, non approuvée) et `docs/FRONTEND_SOURCE_STATUS.md` (sources frontend manquantes, résultats de recherche).
