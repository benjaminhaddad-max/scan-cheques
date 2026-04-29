# Cheques Standalone — Module OCR de chèques

Module standalone, prêt à déployer, qui permet :
- d'**uploader** des images de chèques (JPG/PNG/GIF/TIFF, ou ZIP contenant des images) ;
- de les **traiter automatiquement** via OpenAI GPT-5 vision pour extraire :
  numéro de chèque, montant, date, lieu, banque, numéro de compte, émetteur,
  bénéficiaire, mémo (montant en lettres), texte brut, indicateurs daté/signé,
  score de confiance (0-100) ;
- de **réviser et corriger** chaque chèque dans une fenêtre d'édition ;
- de **modifier en lot** tous les chèques d'un dossier (date, lieu, émetteur, etc.) ;
- d'**exporter le tout en CSV** prêt pour Excel / Google Sheets ;
- de **regrouper** les chèques par dossier (folderId / folderName) avec ordre custom.

> Ce module a été extrait d'une application interne et nettoyé de toute donnée
> sensible (noms de clients, IDs Drive/Sheets, secrets, IBAN, etc.). Les
> placeholders de configuration sont documentés dans `.env.example` et `SETUP.md`.

## Stack

| Couche | Techno |
| --- | --- |
| Framework | Next.js 15 (App Router) |
| Langage | TypeScript |
| UI | React 18 + Tailwind CSS + shadcn/ui + Radix |
| Icônes | lucide-react |
| Base de données | PostgreSQL (Neon recommandé) |
| ORM | Prisma 6 |
| Stockage fichiers | Vercel Blob |
| OCR | OpenAI GPT-5 vision (`/api/ocr-gpt`) |
| Auth | **stub** — à remplacer par Supabase Auth (cf. SETUP.md) |

## Arborescence

```
cheques-standalone/
├── app/
│   ├── layout.tsx               # Layout racine (html/body + globals.css)
│   ├── page.tsx                 # Redirige vers /cheques
│   ├── globals.css              # Variables CSS shadcn + Tailwind
│   ├── cheques/
│   │   └── page.tsx             # Page qui rend <ChequesView />
│   └── api/
│       ├── ocr/
│       │   ├── enqueue/         # POST – enregistre des Blob URLs en file
│       │   ├── uploads/         # GET liste, PATCH/DELETE par id
│       │   ├── upload/          # POST upload simple (image)
│       │   ├── upload-zip/      # POST upload d'un ZIP, extraction & enqueue
│       │   ├── signed-url/      # POST upload alternatif (sans conversion TIFF)
│       │   ├── process-pending/ # POST déclenche le traitement OCR par batch
│       │   ├── cancel-processing/ # POST remet RUNNING → PENDING
│       │   ├── unprocess-all/   # POST remet COMPLETED/FAILED → PENDING
│       │   ├── delete-processed/ # DELETE supprime tous les traités (BD + blob)
│       │   └── export-csv/      # GET export CSV des chèques traités
│       └── ocr-gpt/
│           └── route.ts         # Endpoint OpenAI GPT-5 (prompts éditables)
├── components/
│   ├── dash/
│   │   └── ChequesView.tsx      # Le composant principal (1643 lignes)
│   └── ui/                      # shadcn/ui (card, button, dialog, etc.)
├── lib/
│   ├── auth.ts                  # STUB — remplacer par Supabase Auth
│   ├── prisma.ts                # Singleton Prisma client
│   └── utils.ts                 # `cn()` shadcn
├── prisma/
│   └── schema.prisma            # Modèle OcrUpload uniquement
├── .env.example
├── .gitignore
├── next.config.js
├── package.json
├── postcss.config.js
├── README.md                    # Ce fichier
├── SETUP.md                     # Guide d'installation pas-à-pas
├── tailwind.config.js
└── tsconfig.json
```

## Fonctionnalités couvertes

- Upload par drag & drop ou clic (multi-fichiers).
- Support des archives ZIP : extraction + conversion TIFF → JPEG côté serveur (sharp).
- Pré-visualisation des fichiers avant import définitif.
- File d'attente OCR (`PENDING` → `RUNNING` → `COMPLETED` / `FAILED`) avec polling
  toutes les 2s pendant le traitement.
- Traitement OCR via GPT-5 vision avec :
  - prompt structuré (extraction JSON) ;
  - retry exponentiel sur les rate-limits (429) ;
  - normalisation post-extraction (montants en virgule, suppression du préfixe « à »
    sur le bénéficiaire, suppression d'adresses, extraction du code MICR…) ;
  - étape optionnelle 2 : standardisation de l'émetteur sur une liste fournie
    par l'utilisateur (textarea « Liste des émetteurs »).
- Édition fine d'un chèque (modal) : tous les champs extraits sont modifiables.
- Édition en lot par dossier : applique les mêmes valeurs (date, émetteur, banque,
  bénéficiaire, n° compte) à tous les chèques d'un dossier.
- Indicateurs visuels : statut (PENDING / RUNNING / COMPLETED / FAILED), score
  de confiance coloré (vert/orange/rouge), badges « Daté » et « Signé ».
- Annulation des traitements en cours, remise en attente de tout, suppression
  globale des traités.
- Export CSV avec totaux (nombre de chèques + montant total).

## Limites connues

- **Pas d'authentification réelle.** Le fichier `lib/auth.ts` retourne toujours
  `success: true`. Il **doit** être remplacé par une vraie auth (Supabase, Clerk,
  Auth.js, etc.) avant tout déploiement non-local. Voir SETUP.md.
- **Pas de pagination dans l'UI** : la liste charge jusqu'à 1000 items (limite
  côté API) puis affiche tout. Au-delà, il faudra paginer côté client.
- **Pas de file Redis / QStash** : le traitement par batch est synchrone via
  `Promise.allSettled` côté serveur. Pour de gros volumes, envisager une vraie
  file (BullMQ, QStash, SQS…).
- **Vercel Blob est public** : les URLs des images uploadées sont publiques
  (`access: 'public'`). Si besoin de confidentialité, il faut migrer vers du
  signed URL (S3/R2) ou un stockage privé.
- **Pas de quota / rate-limit applicatif** : OpenAI peut renvoyer des 429
  (gérés par retry exponentiel), mais aucun quota par utilisateur n'est en place.
- Le prompt OCR est en anglais et fortement orienté « chèque français ». Pour
  un autre cas d'usage, voir la section « Adaptation » de SETUP.md.

## Démarrage rapide

```bash
git clone <ce-repo>
cd cheques-standalone
npm install
cp .env.example .env
# Éditer .env (DATABASE_URL, BLOB_READ_WRITE_TOKEN, OPENAI_API_KEY)
npx prisma db push
npm run dev
# → http://localhost:3000/cheques
```

Documentation complète : voir [`SETUP.md`](./SETUP.md).
