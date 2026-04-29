# Guide d'installation — Cheques Standalone

Ce guide vous accompagne pas à pas pour faire tourner le module OCR de chèques en
local, puis (optionnellement) le déployer sur Vercel.

---

## 1. Prérequis

| Outil | Version recommandée | Lien |
| --- | --- | --- |
| Node.js | ≥ 20.x | <https://nodejs.org> |
| npm / pnpm / yarn | npm 10+ | livré avec Node |
| Git | toute version récente | <https://git-scm.com> |
| Compte Postgres | Neon (recommandé), Supabase, Railway, ou Postgres local | <https://console.neon.tech> |
| Compte Vercel | gratuit | <https://vercel.com> |
| Compte OpenAI | avec crédit + accès vision | <https://platform.openai.com> |

---

## 2. Installation

```bash
git clone <url-du-repo> cheques-standalone
cd cheques-standalone
npm install
```

`postinstall` exécute automatiquement `prisma generate`. Si la commande échoue
parce que `DATABASE_URL` n'est pas encore défini, ce n'est pas grave — on le
règle à l'étape suivante puis on relance `npx prisma generate`.

---

## 3. Création de la base de données

### Option A — Neon (recommandée, gratuit)

1. Aller sur <https://console.neon.tech>, créer un compte.
2. **Create project** → choisir une région proche de vos utilisateurs.
3. Dans le dashboard du projet, **Connection Details** → copier la chaîne
   `Pooled connection` ou `Direct connection`. Elle ressemble à :
   ```
   postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
   ```
4. Coller cette valeur dans `.env` (cf. étape 4).

### Option B — Postgres local

```bash
# macOS (homebrew)
brew install postgresql@16
brew services start postgresql@16
createdb cheques_dev
# DATABASE_URL=postgresql://localhost:5432/cheques_dev?schema=public
```

### Création des tables

Une fois `DATABASE_URL` configuré dans `.env` :

```bash
npx prisma db push
```

Cela crée la table `ocr_uploads` directement (sans fichier de migration). Si vous
préférez un workflow migrations versionnées :

```bash
npx prisma migrate dev --name init
```

---

## 4. Variables d'environnement

Copier `.env.example` vers `.env` puis remplir :

| Variable | Rôle | Où la récupérer |
| --- | --- | --- |
| `DATABASE_URL` | Connexion Postgres pour Prisma. | Neon dashboard → Connection Details ; ou votre Postgres local. |
| `BLOB_READ_WRITE_TOKEN` | Jeton lecture/écriture Vercel Blob (stockage des images de chèques). | <https://vercel.com/dashboard/stores> → **Create Blob Store** → onglet **.env.local** → copier `BLOB_READ_WRITE_TOKEN`. |
| `OPENAI_API_KEY` | Clé API OpenAI pour l'OCR via GPT-5 vision. | <https://platform.openai.com/api-keys> → **Create new secret key**. |

Exemple de `.env` rempli (valeurs fictives) :

```env
DATABASE_URL="postgresql://user:****@ep-foo.eu-west-3.aws.neon.tech/cheques?sslmode=require"
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_xxxxx_yyyy"
OPENAI_API_KEY="sk-proj-xxxxxxxx"
```

---

## 5. Génération des clés API — pas à pas

### 5.1 OpenAI (`OPENAI_API_KEY`)

1. Aller sur <https://platform.openai.com/api-keys>.
2. **Create new secret key** → donner un nom (ex. `cheques-standalone-dev`).
3. Copier la clé immédiatement (elle ne sera plus jamais affichée).
4. Vérifier que le compte a du crédit : <https://platform.openai.com/usage>.
5. Vérifier que le modèle `gpt-5` est disponible pour votre compte
   (<https://platform.openai.com/docs/models>). Sinon, voir « Adaptation » §8.

> ⚠️ Coût indicatif : ~0,01 à 0,03 USD par chèque traité (varie selon la
> résolution de l'image et le modèle). Surveillez `Usage` dans le dashboard.

### 5.2 Vercel Blob (`BLOB_READ_WRITE_TOKEN`)

1. Aller sur <https://vercel.com/dashboard/stores>.
2. **Create Database** → **Blob** → choisir un nom et une région.
3. Une fois créé, ouvrir l'onglet **`.env.local`**.
4. Copier la ligne `BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."`.

> Le tier gratuit Vercel Blob suffit largement pour des dizaines de milliers de
> chèques. Au-delà, voir tarifs : <https://vercel.com/docs/storage/vercel-blob>.

### 5.3 Neon (`DATABASE_URL`)

1. <https://console.neon.tech> → **New Project**.
2. Dashboard → **Connection Details**.
3. Copier la connection string (cocher **Pooled connection** pour de meilleures
   perfs en serverless).

---

## 6. Lancement local

```bash
npm run dev
```

→ Ouvrir <http://localhost:3000/cheques>

Vérifications :
- La page s'affiche avec le titre **« Traitement des chèques »** et la zone de
  drag & drop.
- Déposer une image de chèque → elle apparaît dans **Non traités**.
- Cliquer sur **Tout traiter** → le statut passe en `RUNNING` puis `COMPLETED`.
- Ouvrir un chèque traité → les champs extraits sont éditables.
- **Exporter en CSV** → un fichier se télécharge.

Si quelque chose ne marche pas, voir §10 (Troubleshooting).

---

## 7. Déploiement Vercel (optionnel)

1. `git push` votre repo sur GitHub/GitLab/Bitbucket.
2. Sur <https://vercel.com/new>, importer le repo.
3. Dans **Environment Variables**, ajouter `DATABASE_URL`,
   `BLOB_READ_WRITE_TOKEN`, `OPENAI_API_KEY` (mêmes valeurs qu'en local — ou
   différentes pour un environnement de prod dédié).
4. **Deploy**.
5. Une fois déployé, connectez le Blob Store du §5.2 au projet :
   Vercel project → **Storage** → **Connect Store**.
6. Lancer la migration sur la BD de prod :
   ```bash
   DATABASE_URL="<url-prod>" npx prisma db push
   ```

---

## 8. Adaptation pour un autre cas d'usage

Le module est conçu pour des chèques français, mais peut être adapté facilement.

### 8.1 Modifier les champs extraits

**Fichier :** `app/api/ocr-gpt/route.ts`

Le **prompt** GPT (variable `extractionPrompt`) définit le JSON renvoyé. Pour
extraire d'autres champs (ex. : un numéro de facture, une TVA, un IBAN…) :

1. Ajouter le champ dans le JSON exemple du prompt.
2. Adapter ou supprimer les blocs `CRITICAL ... VALIDATION RULES`.
3. Mettre à jour `EditableFields` dans `components/dash/ChequesView.tsx`
   (ligne ~49) et les `<Input>` dans le modal d'édition.
4. Adapter `app/api/ocr/export-csv/route.ts` (entêtes + ligne CSV).

### 8.2 Modifier les libellés UI

**Fichier :** `components/dash/ChequesView.tsx`

- Le titre `Traitement des chèques` (ligne ~654) ;
- Tous les libellés des champs (`Numéro de chèque`, `Bénéficiaire`, etc.) ;
- Les messages de confirmation (`window.confirm(...)`).

Recherche/remplacement direct dans ce fichier suffit pour relabeller le module.

### 8.3 Changer de modèle OpenAI

**Fichier :** `app/api/ocr-gpt/route.ts`, ligne ~`const modelUsed = 'gpt-5';`

Remplacer par `gpt-4o`, `gpt-4o-mini`, etc. selon vos quotas et besoins.
Liste à jour : <https://platform.openai.com/docs/models>.

### 8.4 Désactiver la normalisation locale

**Fichier :** `app/api/ocr-gpt/route.ts`, fonction `normalizeBeneficiaryName()`

Cette fonction est livrée vide (TODO). Vous pouvez y ajouter des règles
spécifiques à votre cas d'usage, ou la laisser tel quel et utiliser uniquement
le textarea « Liste des émetteurs » côté UI.

### 8.5 Stocker les résultats ailleurs

Le composant utilise `parsedJson` (Json arbitraire en BD). Vous pouvez ajouter
des champs typés dans `prisma/schema.prisma` (ex. `amount Decimal?`,
`emetteur String?`) puis les remplir dans `process-pending/route.ts` à côté de
`parsedJson` pour les rendre requêtables.

---

## 9. Branchement Supabase Auth (remplacement du stub)

Par défaut, `lib/auth.ts` retourne toujours `{ success: true }` — **toutes les
routes API sont accessibles sans authentification**. Avant tout déploiement, il
faut remplacer ce stub.

### 9.1 Créer le projet Supabase

1. <https://supabase.com> → **New project**.
2. Récupérer dans **Project Settings → API** :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Activer les providers d'auth voulus (email/password, Google, GitHub…) dans
   **Authentication → Providers**.

### 9.2 Installer les dépendances

```bash
npm install @supabase/supabase-js @supabase/ssr
```

### 9.3 Ajouter les variables d'environnement

Compléter `.env` (et le fichier `.env.example`) :

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
```

### 9.4 Remplacer `lib/auth.ts`

Voici une implémentation type avec les helpers SSR officiels de Supabase :

```ts
// lib/auth.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export interface AuthResult {
  success: boolean;
  user?: { id: string; email?: string };
  errorResponse?: NextResponse;
}

export async function requireAuth(request: NextRequest): Promise<AuthResult> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // En route handler Next 15, on lit les cookies depuis la request
        getAll() {
          return request.cookies.getAll().map((c) => ({
            name: c.name,
            value: c.value,
          }));
        },
        setAll() {
          // Les cookies ne peuvent pas être renvoyés ici directement.
          // Pour le refresh de session, utiliser un middleware Next.js.
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
    },
  };
}
```

### 9.5 Ajouter un middleware pour le refresh de session

Créer `middleware.ts` à la racine :

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### 9.6 Ajouter une page de login

À vous de jouer : créer `app/login/page.tsx` avec
[`@supabase/auth-ui-react`](https://supabase.com/docs/guides/auth/auth-helpers/auth-ui)
ou un formulaire custom appelant `supabase.auth.signInWithPassword(...)`.

### 9.7 Vérifier

- Lancer `npm run dev` ;
- Ouvrir <http://localhost:3000/cheques> sans être connecté → les requêtes API
  doivent renvoyer `401` ;
- Se connecter via la page de login → les requêtes passent.

---

## 10. Troubleshooting

### `PrismaClient` non généré / `@prisma/client did not initialize`

```bash
npx prisma generate
```

Si la commande échoue avec « `DATABASE_URL` not found », créer ou compléter
`.env`, puis relancer.

### La table `ocr_uploads` n'existe pas

```bash
npx prisma db push
```

Vérifier ensuite dans Prisma Studio :

```bash
npx prisma studio
```

### Erreur `BlobAccessError` ou 401 sur `/api/ocr/upload`

- Vérifier que `BLOB_READ_WRITE_TOKEN` est bien défini dans `.env` ;
- Vérifier dans Vercel dashboard que le store n'a pas été supprimé ;
- Vérifier qu'il n'y a pas de blanc/quote en trop dans la valeur copiée ;
- Le préfixe doit être `vercel_blob_rw_...`.

### Erreur OpenAI 429 (rate limit)

Le module a un retry exponentiel intégré (`retryWithBackoff`, jusqu'à 20 tentatives).
Si ça persiste :
- Vérifier votre tier OpenAI (<https://platform.openai.com/account/limits>) ;
- Réduire `BATCH_SIZE` dans `app/api/ocr/process-pending/route.ts` (par défaut 50).

### Erreur OpenAI 400 « model not found » / « unsupported »

Le modèle `gpt-5` n'est pas disponible sur votre compte. Remplacer par `gpt-4o`
dans `app/api/ocr-gpt/route.ts` (`const modelUsed = 'gpt-5'`).

### `Confidence column not found` dans les logs

Le code a un fallback raw SQL si la colonne `confidence` n'existe pas (ancien
schéma). Pour résoudre proprement :

```bash
npx prisma db push
```

### Page blanche après upload, console : `Failed to fetch /api/ocr/uploads`

- Vérifier les logs serveur (`npm run dev` dans un terminal) ;
- Souvent : `DATABASE_URL` mal formé. Tester avec `npx prisma studio`.

### Les images TIFF s'affichent comme cassées

Le serveur convertit automatiquement les TIFF en JPEG via `sharp`. Si la conversion
échoue, vérifier que `sharp` est bien installé (`npm rebuild sharp`).

### Dégradation des perfs après plusieurs centaines de chèques

- Activer pagination côté client dans `ChequesView.tsx` (cf. paramètre `cursor`
  déjà supporté par l'API `/api/ocr/uploads`) ;
- Penser à `delete-processed` ou `unprocess-all` régulièrement pour purger.

### CORS errors si appel depuis un autre domaine

Adapter les `headers()` dans `next.config.js`. Par défaut, ce module n'expose
pas de CORS permissif (contrairement au projet d'origine).
