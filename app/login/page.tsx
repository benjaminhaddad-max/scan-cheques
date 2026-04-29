'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') || '/cheques';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabaseConfigured =
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === 'string' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const supabase = createClient();
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next);
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        setMessage('Compte créé. Vérifie ta boîte mail pour confirmer.');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  if (!supabaseConfigured) {
    return (
      <div className="mx-auto mt-20 max-w-md">
        <Card className="p-6">
          <h1 className="mb-2 text-xl font-semibold">Auth non configurée</h1>
          <p className="text-sm text-gray-600">
            Les variables <code>NEXT_PUBLIC_SUPABASE_URL</code> et{' '}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> ne sont pas définies. L'app
            fonctionne sans authentification tant qu'elles sont absentes.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-20 max-w-md">
      <Card className="p-6">
        <h1 className="mb-4 text-xl font-semibold">
          {mode === 'signin' ? 'Connexion' : 'Créer un compte'}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-600">{message}</p>}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? '...' : mode === 'signin' ? 'Se connecter' : 'Créer le compte'}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setMessage(null);
          }}
          className="mt-4 w-full text-sm text-gray-600 underline"
        >
          {mode === 'signin'
            ? "Pas encore de compte ? Créer un compte"
            : 'Déjà un compte ? Se connecter'}
        </button>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
