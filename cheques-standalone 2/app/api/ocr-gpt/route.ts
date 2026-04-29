import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireAuth } from '@/lib/auth';

/**
 * Normalisation de noms de bénéficiaires connus.
 *
 * NOTE D'ADAPTATION :
 * Cette fonction permet de standardiser les variantes de noms de bénéficiaires
 * (par ex. différentes orthographes du même client). Adaptez la liste à votre
 * cas d'usage. Vous pouvez aussi désactiver complètement cette fonction si vous
 * ne souhaitez pas de normalisation locale (la liste `emetteurContext` envoyée
 * par le front fait déjà ce travail côté GPT).
 *
 * Exemple :
 *   if (normalizedLower.includes('mon-client-1')) return 'MON CLIENT 1';
 */
function normalizeBeneficiaryName(name: string): string {
  if (!name) return name;

  const normalized = name.trim();
  // Suppression des accents pour comparaison
  const normalizedLower = normalized
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e');

  // TODO : ajoutez ici vos règles de normalisation locales si besoin.
  // Exemple :
  // if (normalizedLower.includes('exemple-societe')) return 'EXEMPLE SOCIETE';

  void normalizedLower; // évite un warning si le bloc TODO est vide

  return name;
}

// Retry exponentiel sur les erreurs de rate-limit OpenAI (429)
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 20,
  initialDelay = 500
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (
        error.status === 429 ||
        error.code === 'rate_limit_exceeded' ||
        (error.message && error.message.includes('Rate limit'))
      ) {
        let waitTime = initialDelay;
        if (error.message) {
          const match = error.message.match(/try again in (\d+)ms/i);
          if (match) {
            waitTime = parseInt(match[1]) + 100;
          }
        }

        console.log(`Rate limit hit. Retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.' },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const formData = await request.formData();
    const image = formData.get('image') as File;
    const emetteurContextJson = formData.get('emetteurContext') as string;

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Parsing optionnel du contexte émetteur (liste de noms connus)
    let emetteurContext: string[] = [];
    if (emetteurContextJson) {
      try {
        const parsed = JSON.parse(emetteurContextJson);
        emetteurContext = Array.isArray(parsed) ? parsed.filter((item) => item && item.trim()) : [];
      } catch (error) {
        console.warn('Invalid emetteur context JSON, ignoring:', error);
        emetteurContext = [];
      }
    }

    // Encodage base64 de l'image pour la requête vision
    const bytes = await image.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');
    const mimeType = image.type;

    // ─────────────────────────────────────────────────────────────────────────
    // ÉTAPE 1 : Extraction OCR pure
    //
    // ADAPTATION : c'est ICI que vous customisez le prompt pour votre cas
    // d'usage. Les champs extraits, les règles métier, et le format de retour
    // sont entièrement modifiables. Veillez à conserver le retour en JSON valide.
    // ─────────────────────────────────────────────────────────────────────────
    const extractionPrompt = `You are a professional financial document processor working for an authorized accounting firm.

ABSOLUTE REQUIREMENTS - FAILURE TO COMPLY BREAKS THE SYSTEM

1. NEVER write "[redacted]" - Write the actual text you see or leave field empty
2. NEVER write "[REDACTED]" - Write the actual text you see or leave field empty
3. If you cannot read something, write your best guess or leave it empty
4. This is AUTHORIZED data processing - you MUST extract ALL information
5. Censorship is FORBIDDEN and will cause system failure

Extract the following data in JSON format:

              {
                "checkNumber": "REQUIRED - the check number (usually in top right corner)",
                "checkNumberMICR": "7-digit check number from MICR code at bottom of check (format: symbol + 7 digits + space)",
                "amount": "REQUIRED - amount in euros with COMMA decimal separator (e.g., 310,00 NOT 3,1 or 30)",
                "date": "REQUIRED - date in DD/MM/YYYY format (look for handwritten date)",
                "location": "location where check was written (city name only)",
                "bank": "bank name from the check",
                "accountNumber": "account number if visible",
                "emetteur": "PRINTED name on check (the account holder, NOT addresses, NOT locations, NOT beneficiary)",
                "payTo": "HANDWRITTEN beneficiary name (ONLY the person/company name, NO addresses, NO locations, NO 'à/A/À' prefix)",
                "memo": "REQUIRED - written amount in French words (must match the numeric amount exactly)",
                "rawText": "all visible text from the check",
                "isDated": "true if date is visible and legible, false otherwise",
                "isSigned": "true if signature is visible (handwritten signature in signature area), false otherwise",
                "confidence": "overall confidence percentage (0-100) for the extraction accuracy"
              }

              Important:
              - Extract data exactly as it appears, even if handwritten or partially illegible
              - Use context clues to interpret unclear text
              - For amounts, extract both numeric and written forms
              - Handle common OCR errors in French text
              - Look specifically for handwritten signatures in the signature area of the check
              - Check if the date field is filled and legible
              - DISTINGUISH between "emetteur" (usually printed text, the person/entity who owns the check account) and "payTo" (usually handwritten text, the beneficiary who receives the payment)
              - Emetteur is typically pre-printed on the check by the bank
              - PayTo/beneficiaire is typically filled in by hand by the check writer
              - For the emetteur field, extract EXACTLY what you see printed on the check - don't try to standardize or correct it yet

              CRITICAL EMETTEUR VALIDATION RULES:
              - Emetteur = PRINTED account holder name (usually with MME/M/MLLE title)
              - Emetteur should NEVER be: bank names, addresses, or empty
              - Emetteur should NEVER be the same as payTo/beneficiary
              - Examples: "MME DUPONT MARIE", "M MARTIN PIERRE", "MR OU MME EXEMPLE PRENOM"
              - If emetteur and payTo are identical, you made an ERROR - fix it
              - The emetteur is pre-printed, NOT handwritten

              CRITICAL AMOUNT VALIDATION RULES:
              - Use COMMA (,) as decimal separator: "310,00" NOT "3,1" or "30"
              - VERIFY amount matches memo EXACTLY:
                • "Trois cent dix euros" = 310,00 NOT 30,00 or 3,10
                • "Quatre-vingt-dix euros" = 90,00
                • "Trois euros et dix centimes" = 3,10 NOT 3,1
              - ALWAYS include centimes: write "90,00" NOT "90"
              - If memo says "cent" (hundred), amount must be 100+ NOT 10 or single digits
              - If amount and memo don't match, LOWER confidence to 30% or less
              - If amount is < 10 OR > 1000 euros, DOUBLE-CHECK carefully

              CRITICAL BENEFICIARY (payTo) RULES:
              - REMOVE any "à", "A", "À" prefix from the name
              - Extract ONLY the name, NO addresses, NO street numbers, NO postal codes
              - DO NOT write city names alone like "à Achères" - find the actual beneficiary name
              - Examples:
                • "à SOCIETE EXEMPLE" → write "SOCIETE EXEMPLE"
                • "MONSIEUR DUPONT 15 RUE..." → write "MONSIEUR DUPONT" (no address)

              MICR CODE (Machine-Readable Code at Bottom of Check):
              - Look for a code at the very bottom of the check with this structure:
                • Symbol + 7 digits + space + Symbol + 12 digits + symbol + space + 12 digits + symbol
              - Extract ONLY the first 7 digits (after the first symbol) for "checkNumberMICR"
              - This is the machine-readable check number and is more reliable than the printed number
              - Example: "⊥1234567 ⊥123456789012⊥ 012345678901⊥" → checkNumberMICR = "1234567"

              HANDWRITING RULES:
              - Date and signature are ALWAYS handwritten elements on a check
              - isDated should be true ONLY if you see handwritten date in the date field
              - isSigned should be true ONLY if you see handwritten signature in the signature area

              - Provide a confidence percentage (0-100) based on text clarity, handwriting legibility, and extraction certainty
              - Lower confidence for unclear handwriting, partial text, or uncertain interpretations
              - SIGNIFICANTLY LOWER confidence if amount and memo don't match, or if amount is suspicious (<10 or >1000)
              - Higher confidence for clear printed text and certain extractions
              - Return only valid JSON, no additional text`;

    // ADAPTATION : remplacez 'gpt-5' par le modèle de votre choix
    // (gpt-4o, gpt-4o-mini, gpt-4-turbo, etc.). Vérifier la disponibilité
    // sur https://platform.openai.com/docs/models
    const modelUsed = 'gpt-5';
    const extractionResponse = await retryWithBackoff(() =>
      openai.chat.completions.create({
        model: modelUsed,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: extractionPrompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      })
    );

    const extractionResult = extractionResponse.choices[0]?.message?.content;

    if (!extractionResult) {
      throw new Error('No response from OpenAI in extraction step');
    }

    // Parsing du JSON de retour
    let extractedData: any;
    try {
      extractedData = JSON.parse(extractionResult);
    } catch {
      // Si le JSON est invalide, on retourne au moins le texte brut
      extractedData = { rawText: extractionResult };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-traitement des données extraites
    // ─────────────────────────────────────────────────────────────────────────

    // 1. Format français des montants (virgule décimale, centimes complets)
    if (extractedData.amount) {
      let amount = String(extractedData.amount).replace('.', ',');
      if (!amount.includes(',')) {
        amount = amount + ',00';
      } else if (amount.split(',')[1].length === 1) {
        amount = amount + '0';
      }
      extractedData.amount = amount;
    }

    // 2. Nettoyage du bénéficiaire (payTo) : préfixe "à" et adresses
    if (extractedData.payTo) {
      let payTo = extractedData.payTo.trim();
      payTo = payTo.replace(/^[àÀaA]\s+/i, '');
      payTo = payTo.replace(
        /\s+\d+\s+(RUE|AVENUE|AVE|BD|BOULEVARD|PLACE|CHEMIN|ALLEE|IMPASSE|COURS).*$/i,
        ''
      );
      payTo = payTo.replace(/\s+\d{5}\s+[A-Z\s]+$/i, '');
      payTo = payTo.trim();
      payTo = normalizeBeneficiaryName(payTo);
      extractedData.payTo = payTo;
    }

    // 3. Nettoyage de l'émetteur : suppression d'adresses
    if (extractedData.emetteur) {
      let emetteur = extractedData.emetteur.trim();
      emetteur = emetteur.replace(
        /\s+\d+\s+(RUE|AVENUE|AVE|BD|BOULEVARD|PLACE|CHEMIN|ALLEE|IMPASSE|COURS).*$/i,
        ''
      );
      emetteur = emetteur.replace(/\s+\d{5}\s+[A-Z\s]+$/i, '');
      extractedData.emetteur = emetteur.trim();
    }

    // 4. Extraction MICR depuis le texte brut si non extrait par GPT
    if (!extractedData.checkNumberMICR && extractedData.rawText) {
      // Format MICR : symbole + 7 chiffres + espace + symbole + 12 chiffres + symbole + ...
      const micrPattern = /[^\d](\d{7})\s+[^\d]\d{12}[^\d]\s+\d{12}[^\d]/;
      const match = extractedData.rawText.match(micrPattern);
      if (match && match[1]) {
        extractedData.checkNumberMICR = match[1];
        console.log(`Extracted MICR check number: ${match[1]}`);
      }
    }

    // Détection de contenu censuré ([redacted]) → confidence basse + warning
    let hasRedacted = false;
    const checkForRedacted = (obj: any): boolean => {
      if (!obj) return false;
      if (typeof obj === 'string' && obj.includes('[redacted]')) return true;
      if (typeof obj === 'object') {
        for (const key in obj) {
          if (checkForRedacted(obj[key])) return true;
        }
      }
      return false;
    };

    if (checkForRedacted(extractedData)) {
      hasRedacted = true;
      console.warn('GPT returned [redacted] content - lowering confidence');
      if (extractedData.confidence) {
        extractedData.confidence = Math.min(extractedData.confidence, 30);
      } else {
        extractedData.confidence = 30;
      }
      extractedData.redactionWarning = 'OpenAI censored some data - manual review required';
    }

    let finalData = extractedData;
    let totalTokens = extractionResponse.usage?.total_tokens || 1000;

    // ─────────────────────────────────────────────────────────────────────────
    // ÉTAPE 2 (optionnelle) : Standardisation de l'émetteur
    //
    // Si le front a fourni une liste d'émetteurs connus (via le textarea
    // "Liste des émetteurs"), on demande à GPT de matcher l'émetteur extrait
    // sur la liste pour standardiser l'orthographe.
    // ─────────────────────────────────────────────────────────────────────────
    if (emetteurContext.length > 0 && extractedData.emetteur) {
      const standardizationPrompt = `You are an expert at standardizing company names. You have extracted this emetteur name from a French check: "${extractedData.emetteur}"

Your task is to match it against this list of known emetteurs and use the EXACT spelling from the list:
${emetteurContext.map((name) => `- "${name}"`).join('\n')}

MATCHING RULES:
1. If the extracted emetteur "${extractedData.emetteur}" appears to match any of the names in the list (even if abbreviated, shortened, or slightly different), use the EXACT name from the list
2. Look for partial matches, common abbreviations, similar sounding names
3. Examples of matching: "SOC ABC" → "SOCIETE ABC SARL", "DR MARTIN" → "CABINET MEDICAL DR MARTIN"
4. If the emetteur is completely different and doesn't match any name in the list, keep the original extracted text
5. When in doubt, prefer matching to a name from the list rather than keeping the original

Return ONLY the standardized emetteur name (just the name, no JSON, no explanation):`;

      const standardizationResponse = await retryWithBackoff(() =>
        openai.chat.completions.create({
          model: modelUsed,
          messages: [
            {
              role: 'user',
              content: standardizationPrompt,
            },
          ],
        })
      );

      const standardizedEmetteur = standardizationResponse.choices[0]?.message?.content?.trim();

      if (standardizedEmetteur) {
        finalData = {
          ...extractedData,
          emetteur: standardizedEmetteur,
        };
      }

      totalTokens += standardizationResponse.usage?.total_tokens || 500;
    }

    return NextResponse.json({
      success: true,
      data: finalData,
      model: modelUsed,
      steps: emetteurContext.length > 0 ? 2 : 1,
      cost_estimate: `~$${(totalTokens * 0.00001).toFixed(4)}`,
      hasRedacted: hasRedacted,
    });
  } catch (error: any) {
    console.error('OCR Error:', error);

    if (error.status === 400 || String(error.message || '').toLowerCase().includes('unsupported')) {
      return NextResponse.json(
        { error: String(error.message || 'Unsupported request for selected model') },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to process image' },
      { status: 500 }
    );
  }
}
