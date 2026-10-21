// GENERATED FILE — do not edit. Regenerate with `npm run db:types` after changing a migration.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      account_recovery_requests: {
        Row: {
          id: string
          requester_id: string
          kind: Database["public"]["Enums"]["recovery_kind"]
          requested_username: string
          reason: string
          status: Database["public"]["Enums"]["request_status"]
          reviewed_by: string | null
          reviewed_at: string | null
          review_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          requester_id: string
          kind: Database["public"]["Enums"]["recovery_kind"]
          requested_username: string
          reason: string
          status?: Database["public"]["Enums"]["request_status"]
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          requester_id?: string
          kind?: Database["public"]["Enums"]["recovery_kind"]
          requested_username?: string
          reason?: string
          status?: Database["public"]["Enums"]["request_status"]
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_reason?: string | null
          created_at?: string
        }
        Relationships: []
      }
      admin_roles: {
        Row: {
          user_id: string
          role: Database["public"]["Enums"]["app_role"]
          granted_by: string | null
          granted_at: string
        }
        Insert: {
          user_id: string
          role: Database["public"]["Enums"]["app_role"]
          granted_by?: string | null
          granted_at?: string
        }
        Update: {
          user_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          granted_by?: string | null
          granted_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          value: Json
          description: string
          is_public: boolean
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          key: string
          value: Json
          description?: string
          is_public?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          key?: string
          value?: Json
          description?: string
          is_public?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: number
          actor_id: string | null
          actor_kind: string
          action: string
          target_type: string
          target_id: string | null
          reason: string | null
          before_data: Json | null
          after_data: Json | null
          metadata: Json
          created_at: string
        }
        Insert: {
          actor_id?: string | null
          actor_kind?: string
          action: string
          target_type: string
          target_id?: string | null
          reason?: string | null
          before_data?: Json | null
          after_data?: Json | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          action?: string
          target_type?: string
          target_id?: string | null
          reason?: string | null
          before_data?: Json | null
          after_data?: Json | null
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      challenge_events: {
        Row: {
          id: number
          challenge_id: string
          actor_id: string | null
          from_status: Database["public"]["Enums"]["challenge_status"] | null
          to_status: Database["public"]["Enums"]["challenge_status"]
          detail: string | null
          created_at: string
        }
        Insert: {
          challenge_id: string
          actor_id?: string | null
          from_status?: Database["public"]["Enums"]["challenge_status"] | null
          to_status: Database["public"]["Enums"]["challenge_status"]
          detail?: string | null
          created_at?: string
        }
        Update: {
          challenge_id?: string
          actor_id?: string | null
          from_status?: Database["public"]["Enums"]["challenge_status"] | null
          to_status?: Database["public"]["Enums"]["challenge_status"]
          detail?: string | null
          created_at?: string
        }
        Relationships: []
      }
      challenges: {
        Row: {
          id: string
          challenger_id: string
          recipient_id: string
          challenger_username: string
          recipient_username: string
          time_control: string
          time_class: Database["public"]["Enums"]["time_class"]
          message: string | null
          status: Database["public"]["Enums"]["challenge_status"]
          expires_at: string
          accepted_at: string | null
          responded_at: string | null
          closed_at: string | null
          status_changed_at: string
          status_changed_by: string | null
          next_check_at: string | null
          last_checked_at: string | null
          check_count: number
          settle_until: string | null
          giveup_at: string | null
          candidate_game_ids: string[]
          review_reason: string | null
          processing_until: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          challenger_id?: string
          recipient_id: string
          challenger_username: string
          recipient_username: string
          time_control: string
          time_class: Database["public"]["Enums"]["time_class"]
          message?: string | null
          status?: Database["public"]["Enums"]["challenge_status"]
          expires_at: string
          accepted_at?: string | null
          responded_at?: string | null
          closed_at?: string | null
          status_changed_at?: string
          status_changed_by?: string | null
          next_check_at?: string | null
          last_checked_at?: string | null
          check_count?: number
          settle_until?: string | null
          giveup_at?: string | null
          candidate_game_ids?: string[]
          review_reason?: string | null
          processing_until?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          challenger_id?: string
          recipient_id?: string
          challenger_username?: string
          recipient_username?: string
          time_control?: string
          time_class?: Database["public"]["Enums"]["time_class"]
          message?: string | null
          status?: Database["public"]["Enums"]["challenge_status"]
          expires_at?: string
          accepted_at?: string | null
          responded_at?: string | null
          closed_at?: string | null
          status_changed_at?: string
          status_changed_by?: string | null
          next_check_at?: string | null
          last_checked_at?: string | null
          check_count?: number
          settle_until?: string | null
          giveup_at?: string | null
          candidate_game_ids?: string[]
          review_reason?: string | null
          processing_until?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      chess_account_links: {
        Row: {
          id: string
          user_id: string
          chess_username: string
          chess_player_id: number | null
          verification_method: Database["public"]["Enums"]["verification_method"]
          claim_id: string | null
          verified_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          chess_username: string
          chess_player_id?: number | null
          verification_method: Database["public"]["Enums"]["verification_method"]
          claim_id?: string | null
          verified_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          chess_username?: string
          chess_player_id?: number | null
          verification_method?: Database["public"]["Enums"]["verification_method"]
          claim_id?: string | null
          verified_at?: string
          created_at?: string
        }
        Relationships: []
      }
      chess_archive_state: {
        Row: {
          chess_username: string
          archive_month: string
          etag: string | null
          last_modified: string | null
          checked_at: string
          game_count: number
        }
        Insert: {
          chess_username: string
          archive_month: string
          etag?: string | null
          last_modified?: string | null
          checked_at?: string
          game_count?: number
        }
        Update: {
          chess_username?: string
          archive_month?: string
          etag?: string | null
          last_modified?: string | null
          checked_at?: string
          game_count?: number
        }
        Relationships: []
      }
      chess_link_claims: {
        Row: {
          id: string
          user_id: string
          chess_username: string
          chess_player_id: number | null
          method: Database["public"]["Enums"]["verification_method"]
          status: Database["public"]["Enums"]["link_claim_status"]
          verification_code: string | null
          code_expires_at: string | null
          attempts: number
          last_checked_at: string | null
          last_check_result: string | null
          evidence: Json
          review_reason: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          chess_username: string
          chess_player_id?: number | null
          method?: Database["public"]["Enums"]["verification_method"]
          status?: Database["public"]["Enums"]["link_claim_status"]
          verification_code?: string | null
          code_expires_at?: string | null
          attempts?: number
          last_checked_at?: string | null
          last_check_result?: string | null
          evidence?: Json
          review_reason?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          chess_username?: string
          chess_player_id?: number | null
          method?: Database["public"]["Enums"]["verification_method"]
          status?: Database["public"]["Enums"]["link_claim_status"]
          verification_code?: string | null
          code_expires_at?: string | null
          attempts?: number
          last_checked_at?: string | null
          last_check_result?: string | null
          evidence?: Json
          review_reason?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      chess_link_history: {
        Row: {
          id: string
          user_id: string | null
          chess_username: string
          chess_player_id: number | null
          verification_method: Database["public"]["Enums"]["verification_method"] | null
          verified_at: string | null
          unlinked_at: string
          unlinked_by: string | null
          reason: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          chess_username: string
          chess_player_id?: number | null
          verification_method?: Database["public"]["Enums"]["verification_method"] | null
          verified_at?: string | null
          unlinked_at?: string
          unlinked_by?: string | null
          reason?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          chess_username?: string
          chess_player_id?: number | null
          verification_method?: Database["public"]["Enums"]["verification_method"] | null
          verified_at?: string | null
          unlinked_at?: string
          unlinked_by?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      chess_rating_history: {
        Row: {
          id: number
          user_id: string
          time_class: Database["public"]["Enums"]["time_class"]
          rating: number
          observed_at: string
        }
        Insert: {
          user_id: string
          time_class: Database["public"]["Enums"]["time_class"]
          rating: number
          observed_at?: string
        }
        Update: {
          user_id?: string
          time_class?: Database["public"]["Enums"]["time_class"]
          rating?: number
          observed_at?: string
        }
        Relationships: []
      }
      chess_ratings: {
        Row: {
          user_id: string
          time_class: Database["public"]["Enums"]["time_class"]
          rating: number
          best_rating: number | null
          record_wins: number
          record_losses: number
          record_draws: number
          last_game_at: string | null
          source: string
          fetched_at: string
        }
        Insert: {
          user_id: string
          time_class: Database["public"]["Enums"]["time_class"]
          rating: number
          best_rating?: number | null
          record_wins?: number
          record_losses?: number
          record_draws?: number
          last_game_at?: string | null
          source?: string
          fetched_at?: string
        }
        Update: {
          user_id?: string
          time_class?: Database["public"]["Enums"]["time_class"]
          rating?: number
          best_rating?: number | null
          record_wins?: number
          record_losses?: number
          record_draws?: number
          last_game_at?: string | null
          source?: string
          fetched_at?: string
        }
        Relationships: []
      }
      chess_sync_state: {
        Row: {
          user_id: string
          profile_synced_at: string | null
          stats_synced_at: string | null
          last_success_at: string | null
          last_error: string | null
          last_error_at: string | null
          error_count: number
          next_sync_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          profile_synced_at?: string | null
          stats_synced_at?: string | null
          last_success_at?: string | null
          last_error?: string | null
          last_error_at?: string | null
          error_count?: number
          next_sync_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          profile_synced_at?: string | null
          stats_synced_at?: string | null
          last_success_at?: string | null
          last_error?: string | null
          last_error_at?: string | null
          error_count?: number
          next_sync_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      college_matches: {
        Row: {
          id: string
          challenge_id: string | null
          game_id: string | null
          game_url: string
          white_user_id: string | null
          black_user_id: string | null
          white_username: string
          black_username: string
          result: string
          time_control: string | null
          time_class: Database["public"]["Enums"]["time_class"] | null
          rated: boolean | null
          ended_at: string
          source: Database["public"]["Enums"]["match_source"]
          status: Database["public"]["Enums"]["match_status"]
          evidence: Json
          verified_at: string
          verified_by: string | null
          is_demo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          challenge_id?: string | null
          game_id?: string | null
          game_url: string
          white_user_id?: string | null
          black_user_id?: string | null
          white_username: string
          black_username: string
          result: string
          time_control?: string | null
          time_class?: Database["public"]["Enums"]["time_class"] | null
          rated?: boolean | null
          ended_at: string
          source: Database["public"]["Enums"]["match_source"]
          status?: Database["public"]["Enums"]["match_status"]
          evidence?: Json
          verified_at?: string
          verified_by?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          challenge_id?: string | null
          game_id?: string | null
          game_url?: string
          white_user_id?: string | null
          black_user_id?: string | null
          white_username?: string
          black_username?: string
          result?: string
          time_control?: string | null
          time_class?: Database["public"]["Enums"]["time_class"] | null
          rated?: boolean | null
          ended_at?: string
          source?: Database["public"]["Enums"]["match_source"]
          status?: Database["public"]["Enums"]["match_status"]
          evidence?: Json
          verified_at?: string
          verified_by?: string | null
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      eligibility_requests: {
        Row: {
          id: string
          user_id: string
          claimed_identifier: string
          note: string | null
          status: Database["public"]["Enums"]["request_status"]
          reviewed_by: string | null
          reviewed_at: string | null
          review_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          claimed_identifier: string
          note?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          claimed_identifier?: string
          note?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_reason?: string | null
          created_at?: string
        }
        Relationships: []
      }
      imported_chess_games: {
        Row: {
          id: string
          game_url: string
          game_uuid: string | null
          white_username: string
          black_username: string
          white_rating: number | null
          black_rating: number | null
          white_result: string | null
          black_result: string | null
          winner: string
          time_control: string | null
          time_class: Database["public"]["Enums"]["time_class"] | null
          rules: string
          rated: boolean | null
          started_at: string | null
          ended_at: string
          archive_month: string | null
          source: string
          imported_at: string
        }
        Insert: {
          id?: string
          game_url: string
          game_uuid?: string | null
          white_username: string
          black_username: string
          white_rating?: number | null
          black_rating?: number | null
          white_result?: string | null
          black_result?: string | null
          winner: string
          time_control?: string | null
          time_class?: Database["public"]["Enums"]["time_class"] | null
          rules?: string
          rated?: boolean | null
          started_at?: string | null
          ended_at: string
          archive_month?: string | null
          source?: string
          imported_at?: string
        }
        Update: {
          id?: string
          game_url?: string
          game_uuid?: string | null
          white_username?: string
          black_username?: string
          white_rating?: number | null
          black_rating?: number | null
          white_result?: string | null
          black_result?: string | null
          winner?: string
          time_control?: string | null
          time_class?: Database["public"]["Enums"]["time_class"] | null
          rules?: string
          rated?: boolean | null
          started_at?: string | null
          ended_at?: string
          archive_month?: string | null
          source?: string
          imported_at?: string
        }
        Relationships: []
      }
      job_runs: {
        Row: {
          id: number
          job: string
          started_at: string
          finished_at: string | null
          status: string
          stats: Json
          error: string | null
        }
        Insert: {
          job: string
          started_at?: string
          finished_at?: string | null
          status?: string
          stats?: Json
          error?: string | null
        }
        Update: {
          job?: string
          started_at?: string
          finished_at?: string | null
          status?: string
          stats?: Json
          error?: string | null
        }
        Relationships: []
      }
      match_disputes: {
        Row: {
          id: string
          challenge_id: string
          opened_by: string
          reason: string
          proposed_game_url: string | null
          proposed_result: string | null
          status: Database["public"]["Enums"]["dispute_status"]
          resolved_by: string | null
          resolved_at: string | null
          resolution_note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          challenge_id: string
          opened_by: string
          reason: string
          proposed_game_url?: string | null
          proposed_result?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          resolved_by?: string | null
          resolved_at?: string | null
          resolution_note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          challenge_id?: string
          opened_by?: string
          reason?: string
          proposed_game_url?: string | null
          proposed_result?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          resolved_by?: string | null
          resolved_at?: string | null
          resolution_note?: string | null
          created_at?: string
        }
        Relationships: []
      }
      match_sync_attempts: {
        Row: {
          id: number
          challenge_id: string
          attempted_at: string
          outcome: string
          candidates: number
          detail: Json
          error: string | null
        }
        Insert: {
          challenge_id: string
          attempted_at?: string
          outcome: string
          candidates?: number
          detail?: Json
          error?: string | null
        }
        Update: {
          challenge_id?: string
          attempted_at?: string
          outcome?: string
          candidates?: number
          detail?: Json
          error?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: Database["public"]["Enums"]["notification_type"]
          title: string
          body: string
          data: Json
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: Database["public"]["Enums"]["notification_type"]
          title: string
          body?: string
          data?: Json
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: Database["public"]["Enums"]["notification_type"]
          title?: string
          body?: string
          data?: Json
          read_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      player_stats: {
        Row: {
          user_id: string
          games_played: number
          wins: number
          losses: number
          draws: number
          points: number
          win_rate: number | null
          elo: number
          last_match_at: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          games_played?: number
          wins?: number
          losses?: number
          draws?: number
          points?: number
          win_rate?: number | null
          elo: number
          last_match_at?: string | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          games_played?: number
          wins?: number
          losses?: number
          draws?: number
          points?: number
          win_rate?: number | null
          elo?: number
          last_match_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profile_settings: {
        Row: {
          user_id: string
          presence_mode: Database["public"]["Enums"]["presence_mode"]
          updated_at: string
        }
        Insert: {
          user_id: string
          presence_mode?: Database["public"]["Enums"]["presence_mode"]
          updated_at?: string
        }
        Update: {
          user_id?: string
          presence_mode?: Database["public"]["Enums"]["presence_mode"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          display_name: string
          avatar_url: string | null
          bio: string | null
          preferred_time_classes: Database["public"]["Enums"]["time_class"][]
          open_to_challenges: boolean
          eligibility_status: Database["public"]["Enums"]["eligibility_status"]
          eligibility_source: string | null
          eligibility_verified_at: string | null
          account_status: Database["public"]["Enums"]["account_status"]
          onboarding_completed_at: string | null
          is_approved: boolean
          is_demo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name: string
          avatar_url?: string | null
          bio?: string | null
          preferred_time_classes?: Database["public"]["Enums"]["time_class"][]
          open_to_challenges?: boolean
          eligibility_status?: Database["public"]["Enums"]["eligibility_status"]
          eligibility_source?: string | null
          eligibility_verified_at?: string | null
          account_status?: Database["public"]["Enums"]["account_status"]
          onboarding_completed_at?: string | null
          is_approved?: boolean
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          display_name?: string
          avatar_url?: string | null
          bio?: string | null
          preferred_time_classes?: Database["public"]["Enums"]["time_class"][]
          open_to_challenges?: boolean
          eligibility_status?: Database["public"]["Enums"]["eligibility_status"]
          eligibility_source?: string | null
          eligibility_verified_at?: string | null
          account_status?: Database["public"]["Enums"]["account_status"]
          onboarding_completed_at?: string | null
          is_approved?: boolean
          is_demo?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      student_eligibility: {
        Row: {
          id: string
          kind: string
          value: string
          note: string | null
          created_by: string | null
          created_at: string
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          id?: string
          kind: string
          value: string
          note?: string | null
          created_by?: string | null
          created_at?: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          id?: string
          kind?: string
          value?: string
          note?: string | null
          created_by?: string | null
          created_at?: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: []
      }
      supported_time_controls: {
        Row: {
          time_control: string
          label: string
          time_class: Database["public"]["Enums"]["time_class"]
          sort_order: number
          active: boolean
        }
        Insert: {
          time_control: string
          label: string
          time_class: Database["public"]["Enums"]["time_class"]
          sort_order?: number
          active?: boolean
        }
        Update: {
          time_control?: string
          label?: string
          time_class?: Database["public"]["Enums"]["time_class"]
          sort_order?: number
          active?: boolean
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      admin_add_eligibility: {
        Args: { p_kind: string; p_values: string[]; p_note?: string }
        Returns: number
      }
      admin_correct_match: {
        Args: { p_match_id: string; p_result: string; p_reason: string }
        Returns: undefined
      }
      admin_overview: {
        Args: never
        Returns: Json
      }
      admin_record_manual_result: {
        Args: { p_challenge_id: string; p_game_url: string; p_winner: string; p_white_is_challenger: boolean; p_ended_at: string; p_reason: string }
        Returns: string
      }
      admin_remove_eligibility: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      admin_resolve_challenge_with_game: {
        Args: { p_challenge_id: string; p_game_url: string; p_reason: string }
        Returns: string
      }
      admin_resolve_dispute: {
        Args: { p_dispute_id: string; p_status: Database["public"]["Enums"]["dispute_status"]; p_note: string }
        Returns: undefined
      }
      admin_resolve_recovery: {
        Args: { p_request_id: string; p_approve: boolean; p_reason: string }
        Returns: Database["public"]["Tables"]["account_recovery_requests"]["Row"]
      }
      admin_retry_challenge_sync: {
        Args: { p_challenge_id: string }
        Returns: undefined
      }
      admin_retry_player_sync: {
        Args: { p_user: string }
        Returns: undefined
      }
      admin_review_claim: {
        Args: { p_claim_id: string; p_approve: boolean; p_reason: string; p_player_id?: number }
        Returns: Json
      }
      admin_review_eligibility_request: {
        Args: { p_id: string; p_approve: boolean; p_reason: string }
        Returns: Database["public"]["Tables"]["eligibility_requests"]["Row"]
      }
      admin_set_account_status: {
        Args: { p_user: string; p_suspend: boolean; p_reason: string }
        Returns: undefined
      }
      admin_set_role: {
        Args: { p_user: string; p_role: Database["public"]["Enums"]["app_role"]; p_grant: boolean; p_reason: string }
        Returns: undefined
      }
      admin_set_user_eligibility: {
        Args: { p_user: string; p_status: Database["public"]["Enums"]["eligibility_status"]; p_reason: string }
        Returns: undefined
      }
      admin_unlink_chess_account: {
        Args: { p_user: string; p_reason: string }
        Returns: boolean
      }
      admin_update_setting: {
        Args: { p_key: string; p_value: Json; p_reason: string }
        Returns: undefined
      }
      admin_void_challenge: {
        Args: { p_challenge_id: string; p_reason: string }
        Returns: undefined
      }
      bootstrap_super_admin: {
        Args: { p_email: string }
        Returns: string
      }
      cancel_chess_claim: {
        Args: never
        Returns: undefined
      }
      claim_challenges_for_sync: {
        Args: { p_limit?: number; p_lease_seconds?: number }
        Returns: { id: string; status: Database["public"]["Enums"]["challenge_status"]; challenger_id: string; recipient_id: string; challenger_username: string; recipient_username: string; time_control: string; time_class: Database["public"]["Enums"]["time_class"]; accepted_at: string; giveup_at: string; settle_until: string; check_count: number; candidate_game_ids: string[] }[]
      }
      claim_eligibility: {
        Args: never
        Returns: Database["public"]["Enums"]["eligibility_status"]
      }
      claim_players_for_sync: {
        Args: { p_limit?: number; p_lease_seconds?: number }
        Returns: { user_id: string; chess_username: string; chess_player_id: number }[]
      }
      complete_onboarding: {
        Args: never
        Returns: string
      }
      confirm_chess_link: {
        Args: { p_claim_id: string; p_observed_username: string; p_observed_player_id?: number; p_method?: Database["public"]["Enums"]["verification_method"] }
        Returns: Json
      }
      consume_rate_limit: {
        Args: { p_action: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      expire_stale_challenges: {
        Args: never
        Returns: number
      }
      finalize_challenge_match: {
        Args: { p_challenge_id: string; p_game_id: string; p_evidence?: Json }
        Returns: string
      }
      finish_job_run: {
        Args: { p_id: number; p_status: string; p_stats?: Json; p_error?: string }
        Returns: undefined
      }
      get_leaderboard: {
        Args: { p_board: string; p_time_class?: Database["public"]["Enums"]["time_class"]; p_limit?: number; p_offset?: number }
        Returns: { rank: number; user_id: string; display_name: string; avatar_url: string; chess_username: string; chess_rating: number; ratings_synced_at: string; games_played: number; wins: number; losses: number; draws: number; points: number; win_rate: number; elo: number; matches_30d: number; last_match_at: string; total_count: number }[]
      }
      get_player_directory: {
        Args: { p_search?: string; p_time_class?: Database["public"]["Enums"]["time_class"]; p_min_rating?: number; p_max_rating?: number; p_preferred?: Database["public"]["Enums"]["time_class"]; p_open_only?: boolean; p_sort?: string; p_limit?: number; p_offset?: number }
        Returns: { user_id: string; display_name: string; avatar_url: string; chess_username: string; chess_rating: number; ratings_synced_at: string; games_played: number; wins: number; losses: number; draws: number; win_rate: number; elo: number; last_match_at: string; open_to_challenges: boolean; preferred_time_classes: Database["public"]["Enums"]["time_class"][]; total_count: number }[]
      }
      get_public_summary: {
        Args: never
        Returns: Json
      }
      get_recent_matches: {
        Args: { p_limit?: number; p_offset?: number; p_time_class?: Database["public"]["Enums"]["time_class"]; p_username?: string; p_outcome?: string }
        Returns: { id: string; game_url: string; white_username: string; black_username: string; white_display_name: string; black_display_name: string; result: string; time_control: string; time_class: Database["public"]["Enums"]["time_class"]; rated: boolean; ended_at: string; source: Database["public"]["Enums"]["match_source"]; total_count: number }[]
      }
      import_chess_games: {
        Args: { p_games: Json }
        Returns: number
      }
      is_valid_chess_username: {
        Args: { p_username: string }
        Returns: boolean
      }
      normalize_chess_username: {
        Args: { p_username: string }
        Returns: string
      }
      open_match_dispute: {
        Args: { p_challenge_id: string; p_reason: string; p_game_url?: string; p_result?: string }
        Returns: Database["public"]["Tables"]["match_disputes"]["Row"]
      }
      recompute_all_stats: {
        Args: never
        Returns: undefined
      }
      record_challenge_check: {
        Args: { p_challenge_id: string; p_outcome: string; p_new_status: Database["public"]["Enums"]["challenge_status"]; p_next_check_at?: string; p_settle_until?: string; p_candidates?: string[]; p_detail?: Json; p_error?: string; p_review_reason?: string }
        Returns: undefined
      }
      record_claim_check: {
        Args: { p_claim_id: string; p_result: string }
        Returns: undefined
      }
      record_player_sync: {
        Args: { p_user: string; p_ok: boolean; p_error?: string; p_observed_player_id?: number; p_observed_username?: string; p_avatar_url?: string; p_ratings?: Json; p_next_sync_seconds?: number }
        Returns: Json
      }
      request_account_recovery: {
        Args: { p_kind: Database["public"]["Enums"]["recovery_kind"]; p_username: string; p_reason: string }
        Returns: Database["public"]["Tables"]["account_recovery_requests"]["Row"]
      }
      request_eligibility_review: {
        Args: { p_identifier: string; p_note?: string }
        Returns: Database["public"]["Tables"]["eligibility_requests"]["Row"]
      }
      run_housekeeping: {
        Args: never
        Returns: Json
      }
      start_chess_claim: {
        Args: { p_username: string; p_method?: Database["public"]["Enums"]["verification_method"] }
        Returns: Database["public"]["Tables"]["chess_link_claims"]["Row"]
      }
      start_job_run: {
        Args: { p_job: string }
        Returns: number
      }
      submit_claim_for_review: {
        Args: { p_note: string }
        Returns: Database["public"]["Tables"]["chess_link_claims"]["Row"]
      }
    }
    Enums: {
      account_status: "active" | "suspended"
      app_role: "super_admin" | "verification_admin" | "match_moderator" | "analyst"
      challenge_status: "pending" | "accepted" | "declined" | "cancelled" | "expired" | "waiting_for_game" | "checking_result" | "result_verified" | "needs_review" | "voided"
      dispute_status: "open" | "resolved" | "rejected"
      eligibility_status: "unverified" | "verified" | "revoked"
      link_claim_status: "pending" | "needs_review" | "approved" | "rejected" | "expired" | "cancelled"
      match_source: "automatic" | "admin"
      match_status: "verified" | "disputed" | "voided"
      notification_type: "challenge_received" | "challenge_accepted" | "challenge_declined" | "challenge_cancelled" | "challenge_expired" | "match_verified" | "match_needs_review" | "verification_result" | "recovery_decision" | "eligibility_result" | "dispute_update" | "account_notice"
      presence_mode: "available" | "busy" | "invisible"
      recovery_kind: "change_username" | "transfer_username"
      request_status: "open" | "approved" | "rejected"
      time_class: "bullet" | "blitz" | "rapid" | "daily"
      verification_method: "profile_code" | "oauth" | "admin_review"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

export const Constants = {
  public: {
    Enums: {
    account_status: ["active", "suspended"],
    app_role: ["super_admin", "verification_admin", "match_moderator", "analyst"],
    challenge_status: ["pending", "accepted", "declined", "cancelled", "expired", "waiting_for_game", "checking_result", "result_verified", "needs_review", "voided"],
    dispute_status: ["open", "resolved", "rejected"],
    eligibility_status: ["unverified", "verified", "revoked"],
    link_claim_status: ["pending", "needs_review", "approved", "rejected", "expired", "cancelled"],
    match_source: ["automatic", "admin"],
    match_status: ["verified", "disputed", "voided"],
    notification_type: ["challenge_received", "challenge_accepted", "challenge_declined", "challenge_cancelled", "challenge_expired", "match_verified", "match_needs_review", "verification_result", "recovery_decision", "eligibility_result", "dispute_update", "account_notice"],
    presence_mode: ["available", "busy", "invisible"],
    recovery_kind: ["change_username", "transfer_username"],
    request_status: ["open", "approved", "rejected"],
    time_class: ["bullet", "blitz", "rapid", "daily"],
    verification_method: ["profile_code", "oauth", "admin_review"],
    },
  },
} as const
