import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/**
 * Single shared Supabase client for the whole app.
 * Nothing else may call createClient() — inject this service instead.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
    readonly client: SupabaseClient = createClient(
        environment.supabaseUrl,
        environment.supabasePublishableKey,
        {
            auth: {
                // PKCE keeps tokens out of the redirect URL; the ?code in
                // /auth/callback is exchanged automatically on client init.
                flowType: 'pkce',
                detectSessionInUrl: true,
                persistSession: true,
                autoRefreshToken: true
            }
        }
    );
}
