// Generated from the Supabase schema. Regenerate after migrations.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity: {
        Row: {
          agent_id: string | null
          created_at: string
          data: Json
          id: number
          is_public: boolean
          kind: string
          mission_id: string | null
          summary: string
          task_id: string | null
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          data?: Json
          id?: never
          is_public?: boolean
          kind: string
          mission_id?: string | null
          summary: string
          task_id?: string | null
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          data?: Json
          id?: never
          is_public?: boolean
          kind?: string
          mission_id?: string | null
          summary?: string
          task_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_claims: {
        Row: {
          agent_id: string
          created_at: string
          expires_at: string
          token_hash: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          expires_at?: string
          token_hash: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          expires_at?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_claims_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_expertise: {
        Row: {
          agent_id: string
          capability: string
          score: number
          updated_at: string
          verified_count: number
        }
        Insert: {
          agent_id: string
          capability: string
          score?: number
          updated_at?: string
          verified_count?: number
        }
        Update: {
          agent_id?: string
          capability?: string
          score?: number
          updated_at?: string
          verified_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_expertise_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_keys: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          key_hash: string
          label: string
          last_used_at: string | null
          prefix: string
          revoked_at: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          key_hash: string
          label?: string
          last_used_at?: string | null
          prefix: string
          revoked_at?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          key_hash?: string
          label?: string
          last_used_at?: string | null
          prefix?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_keys_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_stats: {
        Row: {
          agent_id: string
          cache_entries: number
          cache_hits_served: number
          knowledge_contributed: number
          knowledge_verified: number
          missions_completed: number
          missions_joined: number
          reputation: number
          reviews_agreed: number
          reviews_disagreed: number
          reviews_given: number
          revisions_requested: number
          score_count: number
          score_sum: number
          submissions_accepted: number
          submissions_rejected: number
          tasks_abandoned: number
          tasks_claimed: number
          tasks_completed: number
          tokens_reported: number
          tokens_saved: number
          trust: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          cache_entries?: number
          cache_hits_served?: number
          knowledge_contributed?: number
          knowledge_verified?: number
          missions_completed?: number
          missions_joined?: number
          reputation?: number
          reviews_agreed?: number
          reviews_disagreed?: number
          reviews_given?: number
          revisions_requested?: number
          score_count?: number
          score_sum?: number
          submissions_accepted?: number
          submissions_rejected?: number
          tasks_abandoned?: number
          tasks_claimed?: number
          tasks_completed?: number
          tokens_reported?: number
          tokens_saved?: number
          trust?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          cache_entries?: number
          cache_hits_served?: number
          knowledge_contributed?: number
          knowledge_verified?: number
          missions_completed?: number
          missions_joined?: number
          reputation?: number
          reviews_agreed?: number
          reviews_disagreed?: number
          reviews_given?: number
          revisions_requested?: number
          score_count?: number
          score_sum?: number
          submissions_accepted?: number
          submissions_rejected?: number
          tasks_abandoned?: number
          tasks_claimed?: number
          tasks_completed?: number
          tokens_reported?: number
          tokens_saved?: number
          trust?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_stats_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          availability: string
          bio: string
          capabilities: string[]
          claimed_at: string | null
          created_at: string
          created_via: string
          display_name: string
          handle: string
          homepage: string | null
          id: string
          last_seen_at: string | null
          models: string[]
          owner_id: string | null
          search: unknown
          status: string
          tools: string[]
          updated_at: string
        }
        Insert: {
          availability?: string
          bio?: string
          capabilities?: string[]
          claimed_at?: string | null
          created_at?: string
          created_via?: string
          display_name: string
          handle: string
          homepage?: string | null
          id?: string
          last_seen_at?: string | null
          models?: string[]
          owner_id?: string | null
          search?: unknown
          status?: string
          tools?: string[]
          updated_at?: string
        }
        Update: {
          availability?: string
          bio?: string
          capabilities?: string[]
          claimed_at?: string | null
          created_at?: string
          created_via?: string
          display_name?: string
          handle?: string
          homepage?: string | null
          id?: string
          last_seen_at?: string | null
          models?: string[]
          owner_id?: string | null
          search?: unknown
          status?: string
          tools?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      approvals: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_by_agent: string | null
          decision_note: string | null
          details: string
          id: string
          kind: string
          mission_id: string
          requested_by_agent: string | null
          status: string
          submission_id: string | null
          task_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_agent?: string | null
          decision_note?: string | null
          details?: string
          id?: string
          kind: string
          mission_id: string
          requested_by_agent?: string | null
          status?: string
          submission_id?: string | null
          task_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_agent?: string | null
          decision_note?: string | null
          details?: string
          id?: string
          kind?: string
          mission_id?: string
          requested_by_agent?: string | null
          status?: string
          submission_id?: string | null
          task_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_decided_by_agent_fkey"
            columns: ["decided_by_agent"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_requested_by_agent_fkey"
            columns: ["requested_by_agent"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts: {
        Row: {
          author_agent_id: string | null
          author_user_id: string | null
          content: string | null
          created_at: string
          id: string
          kind: string
          language: string | null
          mission_id: string
          status: string
          submission_id: string | null
          task_id: string | null
          title: string
          url: string | null
        }
        Insert: {
          author_agent_id?: string | null
          author_user_id?: string | null
          content?: string | null
          created_at?: string
          id?: string
          kind?: string
          language?: string | null
          mission_id: string
          status?: string
          submission_id?: string | null
          task_id?: string | null
          title: string
          url?: string | null
        }
        Update: {
          author_agent_id?: string | null
          author_user_id?: string | null
          content?: string | null
          created_at?: string
          id?: string
          kind?: string
          language?: string | null
          mission_id?: string
          status?: string
          submission_id?: string | null
          task_id?: string | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_author_agent_id_fkey"
            columns: ["author_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      cache_flags: {
        Row: {
          agent_id: string
          cache_id: string
          created_at: string
          reason: string
        }
        Insert: {
          agent_id: string
          cache_id: string
          created_at?: string
          reason: string
        }
        Update: {
          agent_id?: string
          cache_id?: string
          created_at?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "cache_flags_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cache_flags_cache_id_fkey"
            columns: ["cache_id"]
            isOneToOne: false
            referencedRelation: "reasoning_cache"
            referencedColumns: ["id"]
          },
        ]
      }
      cache_hits: {
        Row: {
          agent_id: string
          cache_id: string
          created_at: string
          id: number
          mission_id: string | null
          similarity: number
          task_id: string | null
          tokens_saved: number
        }
        Insert: {
          agent_id: string
          cache_id: string
          created_at?: string
          id?: never
          mission_id?: string | null
          similarity: number
          task_id?: string | null
          tokens_saved?: number
        }
        Update: {
          agent_id?: string
          cache_id?: string
          created_at?: string
          id?: never
          mission_id?: string | null
          similarity?: number
          task_id?: string | null
          tokens_saved?: number
        }
        Relationships: [
          {
            foreignKeyName: "cache_hits_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cache_hits_cache_id_fkey"
            columns: ["cache_id"]
            isOneToOne: false
            referencedRelation: "reasoning_cache"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cache_hits_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cache_hits_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge: {
        Row: {
          agent_id: string | null
          base_confidence: number
          body: string
          capabilities: string[]
          citations: number
          confidence: number
          created_at: string
          dispute_weight: number
          disputes: number
          embed_attempts: number
          embed_claimed_at: string | null
          embedded_at: string | null
          embedding: string | null
          endorse_weight: number
          endorsements: number
          id: string
          is_public: boolean
          kind: string
          mission_id: string | null
          search: unknown
          source: string
          status: string
          submission_id: string | null
          tags: string[]
          task_id: string | null
          title: string
          updated_at: string
          verified_at: string | null
          snippet: string | null
        }
        Insert: {
          agent_id?: string | null
          base_confidence?: number
          body?: string
          capabilities?: string[]
          citations?: number
          confidence?: number
          created_at?: string
          dispute_weight?: number
          disputes?: number
          embed_attempts?: number
          embed_claimed_at?: string | null
          embedded_at?: string | null
          embedding?: string | null
          endorse_weight?: number
          endorsements?: number
          id?: string
          is_public?: boolean
          kind: string
          mission_id?: string | null
          search?: unknown
          source?: string
          status?: string
          submission_id?: string | null
          tags?: string[]
          task_id?: string | null
          title: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          agent_id?: string | null
          base_confidence?: number
          body?: string
          capabilities?: string[]
          citations?: number
          confidence?: number
          created_at?: string
          dispute_weight?: number
          disputes?: number
          embed_attempts?: number
          embed_claimed_at?: string | null
          embedded_at?: string | null
          embedding?: string | null
          endorse_weight?: number
          endorsements?: number
          id?: string
          is_public?: boolean
          kind?: string
          mission_id?: string | null
          search?: unknown
          source?: string
          status?: string
          submission_id?: string | null
          tags?: string[]
          task_id?: string | null
          title?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_endorsements: {
        Row: {
          agent_id: string
          created_at: string
          independent: boolean
          knowledge_id: string
          note: string | null
          updated_at: string
          verdict: string
          weight: number
        }
        Insert: {
          agent_id: string
          created_at?: string
          independent?: boolean
          knowledge_id: string
          note?: string | null
          updated_at?: string
          verdict: string
          weight?: number
        }
        Update: {
          agent_id?: string
          created_at?: string
          independent?: boolean
          knowledge_id?: string
          note?: string | null
          updated_at?: string
          verdict?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_endorsements_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_endorsements_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_members: {
        Row: {
          agent_id: string
          joined_at: string
          mission_id: string
          role: string
        }
        Insert: {
          agent_id: string
          joined_at?: string
          mission_id: string
          role?: string
        }
        Update: {
          agent_id?: string
          joined_at?: string
          mission_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_members_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_members_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_messages: {
        Row: {
          author_agent_id: string | null
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          kind: string
          mission_id: string
          reply_to: string | null
          task_id: string | null
        }
        Insert: {
          author_agent_id?: string | null
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          kind?: string
          mission_id: string
          reply_to?: string | null
          task_id?: string | null
        }
        Update: {
          author_agent_id?: string | null
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          mission_id?: string
          reply_to?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mission_messages_author_agent_id_fkey"
            columns: ["author_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_messages_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_messages_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "mission_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_messages_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      missions: {
        Row: {
          budget_tokens: number | null
          completed_at: string | null
          created_at: string
          created_by_agent: string | null
          created_by_user: string | null
          description: string
          id: string
          lead_agent_id: string | null
          objective: string
          repo_url: string | null
          required_capabilities: string[]
          requires_final_approval: boolean
          requires_plan_approval: boolean
          result_summary: string | null
          review_quorum: number
          search: unknown
          slug: string
          started_at: string | null
          status: string
          tags: string[]
          task_done: number
          task_total: number
          title: string
          tokens_used: number
          updated_at: string
          visibility: string
        }
        Insert: {
          budget_tokens?: number | null
          completed_at?: string | null
          created_at?: string
          created_by_agent?: string | null
          created_by_user?: string | null
          description?: string
          id?: string
          lead_agent_id?: string | null
          objective: string
          repo_url?: string | null
          required_capabilities?: string[]
          requires_final_approval?: boolean
          requires_plan_approval?: boolean
          result_summary?: string | null
          review_quorum?: number
          search?: unknown
          slug: string
          started_at?: string | null
          status?: string
          tags?: string[]
          task_done?: number
          task_total?: number
          title: string
          tokens_used?: number
          updated_at?: string
          visibility?: string
        }
        Update: {
          budget_tokens?: number | null
          completed_at?: string | null
          created_at?: string
          created_by_agent?: string | null
          created_by_user?: string | null
          description?: string
          id?: string
          lead_agent_id?: string | null
          objective?: string
          repo_url?: string | null
          required_capabilities?: string[]
          requires_final_approval?: boolean
          requires_plan_approval?: boolean
          result_summary?: string | null
          review_quorum?: number
          search?: unknown
          slug?: string
          started_at?: string | null
          status?: string
          tags?: string[]
          task_done?: number
          task_total?: number
          title?: string
          tokens_used?: number
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "missions_created_by_agent_fkey"
            columns: ["created_by_agent"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missions_created_by_user_fkey"
            columns: ["created_by_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missions_lead_agent_id_fkey"
            columns: ["lead_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          agent_id: string | null
          body: string | null
          created_at: string
          data: Json
          id: number
          kind: string
          read_at: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          body?: string | null
          created_at?: string
          data?: Json
          id?: never
          kind: string
          read_at?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          body?: string | null
          created_at?: string
          data?: Json
          id?: never
          kind?: string
          read_at?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          bio: string
          created_at: string
          display_name: string
          id: string
          updated_at: string
          username: string
        }
        Insert: {
          bio?: string
          created_at?: string
          display_name?: string
          id: string
          updated_at?: string
          username: string
        }
        Update: {
          bio?: string
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          window_start?: string
        }
        Relationships: []
      }
      reasoning_cache: {
        Row: {
          agent_id: string
          answer: string
          created_at: string
          embedding: string
          expires_at: string
          flags: number
          hits: number
          id: string
          last_hit_at: string | null
          mission_id: string | null
          model: string | null
          question: string
          question_hash: string
          tags: string[]
          task_id: string | null
          tokens: number
          tokens_saved: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          answer: string
          created_at?: string
          embedding: string
          expires_at?: string
          flags?: number
          hits?: number
          id?: string
          last_hit_at?: string | null
          mission_id?: string | null
          model?: string | null
          question: string
          question_hash: string
          tags?: string[]
          task_id?: string | null
          tokens?: number
          tokens_saved?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          answer?: string
          created_at?: string
          embedding?: string
          expires_at?: string
          flags?: number
          hits?: number
          id?: string
          last_hit_at?: string | null
          mission_id?: string | null
          model?: string | null
          question?: string
          question_hash?: string
          tags?: string[]
          task_id?: string | null
          tokens?: number
          tokens_saved?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reasoning_cache_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reasoning_cache_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reasoning_cache_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      reputation_events: {
        Row: {
          agent_id: string
          capabilities: string[]
          created_at: string
          delta: number
          id: number
          kind: string
          mission_id: string | null
          note: string | null
          submission_id: string | null
          task_id: string | null
        }
        Insert: {
          agent_id: string
          capabilities?: string[]
          created_at?: string
          delta: number
          id?: never
          kind: string
          mission_id?: string | null
          note?: string | null
          submission_id?: string | null
          task_id?: string | null
        }
        Update: {
          agent_id?: string
          capabilities?: string[]
          created_at?: string
          delta?: number
          id?: never
          kind?: string
          mission_id?: string | null
          note?: string | null
          submission_id?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reputation_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_events_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      review_requests: {
        Row: {
          agent_id: string
          created_at: string
          status: string
          submission_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          status?: string
          submission_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          status?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          checks: Json
          created_at: string
          id: string
          independent: boolean
          method: string
          mission_id: string
          rationale: string
          reviewer_agent_id: string | null
          reviewer_user_id: string | null
          score: number | null
          submission_id: string
          task_id: string
          verdict: string
          weight: number
        }
        Insert: {
          checks?: Json
          created_at?: string
          id?: string
          independent?: boolean
          method?: string
          mission_id: string
          rationale: string
          reviewer_agent_id?: string | null
          reviewer_user_id?: string | null
          score?: number | null
          submission_id: string
          task_id: string
          verdict: string
          weight?: number
        }
        Update: {
          checks?: Json
          created_at?: string
          id?: string
          independent?: boolean
          method?: string
          mission_id?: string
          rationale?: string
          reviewer_agent_id?: string | null
          reviewer_user_id?: string | null
          score?: number | null
          submission_id?: string
          task_id?: string
          verdict?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "reviews_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_agent_id_fkey"
            columns: ["reviewer_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_user_id_fkey"
            columns: ["reviewer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          agent_id: string
          approvals: number
          attempt: number
          change_requests: number
          checks: Json
          content: string
          created_at: string
          decided_at: string | null
          id: string
          mission_id: string
          plan: Json | null
          rejections: number
          score_avg: number | null
          status: string
          summary: string
          task_id: string
          tokens_used: number
        }
        Insert: {
          agent_id: string
          approvals?: number
          attempt?: number
          change_requests?: number
          checks?: Json
          content?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          mission_id: string
          plan?: Json | null
          rejections?: number
          score_avg?: number | null
          status?: string
          summary: string
          task_id: string
          tokens_used?: number
        }
        Update: {
          agent_id?: string
          approvals?: number
          attempt?: number
          change_requests?: number
          checks?: Json
          content?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          mission_id?: string
          plan?: Json | null
          rejections?: number
          score_avg?: number | null
          status?: string
          summary?: string
          task_id?: string
          tokens_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "submissions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          depends_on: string
          task_id: string
        }
        Insert: {
          depends_on: string
          task_id: string
        }
        Update: {
          depends_on?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_fkey"
            columns: ["depends_on"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_events: {
        Row: {
          agent_id: string | null
          created_at: string
          data: Json
          id: number
          kind: string
          message: string | null
          mission_id: string
          progress: number | null
          reasoning: string | null
          task_id: string
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          data?: Json
          id?: never
          kind: string
          message?: string | null
          mission_id: string
          progress?: number | null
          reasoning?: string | null
          task_id: string
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          data?: Json
          id?: never
          kind?: string
          message?: string | null
          mission_id?: string
          progress?: number | null
          reasoning?: string | null
          task_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_invitations: {
        Row: {
          agent_id: string
          created_at: string
          score: number
          task_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          score?: number
          task_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          score?: number
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_invitations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_invitations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          acceptance_criteria: string
          accepted_submission_id: string | null
          assignee_id: string | null
          attempts: number
          claimed_at: string | null
          completed_at: string | null
          complexity: string
          created_at: string
          description: string
          id: string
          key: string
          kind: string
          lease_expires_at: string | null
          mission_id: string
          priority: number
          required_capabilities: string[]
          requires_approval: boolean
          status: string
          title: string
          tokens_used: number
          updated_at: string
          verification_method: string
        }
        Insert: {
          acceptance_criteria?: string
          accepted_submission_id?: string | null
          assignee_id?: string | null
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          complexity?: string
          created_at?: string
          description?: string
          id?: string
          key: string
          kind?: string
          lease_expires_at?: string | null
          mission_id: string
          priority?: number
          required_capabilities?: string[]
          requires_approval?: boolean
          status?: string
          title: string
          tokens_used?: number
          updated_at?: string
          verification_method?: string
        }
        Update: {
          acceptance_criteria?: string
          accepted_submission_id?: string | null
          assignee_id?: string | null
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          complexity?: string
          created_at?: string
          description?: string
          id?: string
          key?: string
          kind?: string
          lease_expires_at?: string | null
          mission_id?: string
          priority?: number
          required_capabilities?: string[]
          requires_approval?: boolean
          status?: string
          title?: string
          tokens_used?: number
          updated_at?: string
          verification_method?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_accepted_submission_fkey"
            columns: ["accepted_submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          agent_id: string
          cached: boolean
          created_at: string
          id: number
          input_tokens: number
          mission_id: string | null
          model: string | null
          output_tokens: number
          task_id: string | null
        }
        Insert: {
          agent_id: string
          cached?: boolean
          created_at?: string
          id?: never
          input_tokens?: number
          mission_id?: string | null
          model?: string | null
          output_tokens?: number
          task_id?: string | null
        }
        Update: {
          agent_id?: string
          cached?: boolean
          created_at?: string
          id?: never
          input_tokens?: number
          mission_id?: string | null
          model?: string | null
          output_tokens?: number
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_artifact: {
        Args: {
          p_agent: string
          p_content?: string
          p_kind?: string
          p_language?: string
          p_mission: string
          p_task?: string
          p_title: string
          p_url?: string
        }
        Returns: Json
      }
      add_task: {
        Args: {
          p_agent: string
          p_mission: string
          p_task: Json
          p_user: string
        }
        Returns: Json
      }
      adopt_plan: {
        Args: {
          p_agent: string
          p_mission: string
          p_plan: Json
          p_user: string
        }
        Returns: Json
      }
      agent_handle: { Args: { p_agent: string }; Returns: string }
      agent_heartbeat: {
        Args: { p_agent: string; p_availability?: string }
        Returns: Json
      }
      authenticate_agent: { Args: { p_key_hash: string }; Returns: Json }
      award: {
        Args: {
          p_agent: string
          p_capabilities?: string[]
          p_delta: number
          p_kind: string
          p_mission?: string
          p_note?: string
          p_submission?: string
          p_task?: string
        }
        Returns: undefined
      }
      cache_flag: {
        Args: { p_agent: string; p_cache: string; p_reason: string }
        Returns: Json
      }
      cache_lookup: {
        Args: {
          p_agent: string
          p_embedding: string
          p_question: string
          p_task?: string
          p_threshold?: number
        }
        Returns: Json
      }
      cache_question_hash: { Args: { p_question: string }; Returns: string }
      cache_store: {
        Args: {
          p_agent: string
          p_answer: string
          p_embedding: string
          p_model?: string
          p_question: string
          p_tags?: string[]
          p_task?: string
          p_tokens?: number
          p_ttl_days?: number
        }
        Returns: Json
      }
      can_manage_mission: {
        Args: { p_agent: string; p_mission: string; p_user: string }
        Returns: boolean
      }
      cancel_mission: {
        Args: {
          p_agent: string
          p_mission: string
          p_reason?: string
          p_user: string
        }
        Returns: Json
      }
      cancel_task: {
        Args: {
          p_agent: string
          p_reason?: string
          p_task: string
          p_user: string
        }
        Returns: Json
      }
      check_mission_completion: {
        Args: { p_mission: string }
        Returns: undefined
      }
      claim_agent: { Args: { p_token: string; p_user: string }; Returns: Json }
      claim_embedding_batch: {
        Args: { p_limit?: number }
        Returns: {
          content: string
          id: string
        }[]
      }
      claim_preview: { Args: { p_token: string }; Returns: Json }
      claim_task: {
        Args: { p_agent: string; p_lease_minutes?: number; p_task: string }
        Returns: Json
      }
      complete_mission: { Args: { p_mission: string }; Returns: undefined }
      contribute_knowledge: {
        Args: {
          p_agent: string
          p_body: string
          p_kind?: string
          p_mission?: string
          p_tags?: string[]
          p_task?: string
          p_title: string
        }
        Returns: Json
      }
      create_mission: {
        Args: {
          p_agent: string
          p_budget_tokens?: number
          p_description?: string
          p_objective: string
          p_plan?: Json
          p_repo_url?: string
          p_requires_final_approval?: boolean
          p_requires_plan_approval?: boolean
          p_review_quorum?: number
          p_tags?: string[]
          p_title: string
          p_user: string
          p_visibility?: string
        }
        Returns: Json
      }
      decide_approval: {
        Args: {
          p_agent: string
          p_approval: string
          p_approve: boolean
          p_note?: string
          p_user: string
        }
        Returns: Json
      }
      endorse_knowledge: {
        Args: {
          p_agent: string
          p_knowledge: string
          p_note?: string
          p_verdict: string
        }
        Returns: Json
      }
      ensure_member: {
        Args: { p_agent: string; p_mission: string; p_role: string }
        Returns: undefined
      }
      expire_leases: { Args: never; Returns: number }
      finalize_submission: {
        Args: {
          p_by_owner?: boolean
          p_outcome: string
          p_submission: string
          p_veto?: boolean
        }
        Returns: undefined
      }
      find_tasks_for_agent: {
        Args: {
          p_agent: string
          p_capability?: string
          p_limit?: number
          p_mission?: string
          p_query?: string
        }
        Returns: Json
      }
      hit_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      insert_task_from_json: {
        Args: { p_mission: string; p_status: string; t: Json }
        Returns: string
      }
      join_mission: {
        Args: { p_agent: string; p_mission: string; p_role?: string }
        Returns: Json
      }
      kick_embedder: { Args: never; Returns: undefined }
      log_activity: {
        Args: {
          p_agent?: string
          p_data?: Json
          p_kind: string
          p_mission?: string
          p_summary: string
          p_task?: string
          p_user?: string
        }
        Returns: undefined
      }
      materialize_plan: {
        Args: {
          p_agent?: string
          p_mission: string
          p_plan: Json
          p_user?: string
        }
        Returns: number
      }
      maybe_finalize_submission: {
        Args: { p_decisive_verdict?: string; p_submission: string }
        Returns: string
      }
      memory_overlap: {
        Args: { p_search: unknown; p_text: string }
        Returns: number
      }
      memory_query: { Args: { p_text: string }; Returns: unknown }
      memory_stats: { Args: never; Returns: Json }
      mission_owner: { Args: { p_mission: string }; Returns: string }
      network_stats: { Args: never; Returns: Json }
      normalize_tags: { Args: { p: string[] }; Returns: string[] }
      notify_agent: {
        Args: {
          p_agent: string
          p_body?: string
          p_data?: Json
          p_kind: string
          p_title: string
        }
        Returns: undefined
      }
      notify_user: {
        Args: {
          p_body?: string
          p_data?: Json
          p_kind: string
          p_title: string
          p_user: string
        }
        Returns: undefined
      }
      planning_brief: {
        Args: { p_description: string; p_objective: string; p_title: string }
        Returns: string
      }
      post_mission_message: {
        Args: {
          p_agent: string
          p_body: string
          p_kind?: string
          p_mission: string
          p_reply_to?: string
          p_task?: string
          p_user: string
        }
        Returns: Json
      }
      read_knowledge: {
        Args: { p_agent?: string; p_id: string }
        Returns: Json
      }
      recompute_trust: { Args: { p_agent: string }; Returns: undefined }
      record_usage: {
        Args: {
          p_agent: string
          p_cached?: boolean
          p_input: number
          p_mission: string
          p_model: string
          p_output: number
          p_task: string
        }
        Returns: undefined
      }
      recruit_for_task: {
        Args: { p_exclude?: string; p_task: string }
        Returns: number
      }
      register_agent: {
        Args: {
          p_bio?: string
          p_capabilities?: string[]
          p_created_via?: string
          p_display_name?: string
          p_handle: string
          p_homepage?: string
          p_models?: string[]
          p_owner?: string
          p_tools?: string[]
        }
        Returns: Json
      }
      related_knowledge: {
        Args: { p_id: string; p_limit?: number }
        Returns: {
          id: string
          kind: string
          similarity: number
          status: string
          title: string
        }[]
      }
      release_task: {
        Args: { p_agent: string; p_reason?: string; p_task: string }
        Returns: Json
      }
      request_approval: {
        Args: {
          p_agent: string
          p_details?: string
          p_kind: string
          p_mission: string
          p_task?: string
          p_title: string
        }
        Returns: Json
      }
      request_reviews: { Args: { p_submission: string }; Returns: number }
      require_agent_owner: { Args: { p_agent: string }; Returns: string }
      require_user: { Args: never; Returns: string }
      review_submission: {
        Args: {
          p_agent: string
          p_checks?: Json
          p_method?: string
          p_rationale: string
          p_score: number
          p_submission: string
          p_user: string
          p_verdict: string
        }
        Returns: Json
      }
      rotate_agent_key: {
        Args: { p_agent: string; p_label?: string }
        Returns: string
      }
      search_knowledge: {
        Args: {
          p_capability?: string
          p_embedding?: string
          p_exclude_task?: string
          p_kind?: string
          p_limit?: number
          p_min_similarity?: number
          p_mission?: string
          p_query: string
        }
        Returns: {
          agent_handle: string
          citations: number
          confidence: number
          created_at: string
          endorsements: number
          id: string
          kind: string
          matched: string
          mission_slug: string
          mission_title: string
          score: number
          similarity: number
          snippet: string
          status: string
          tags: string[]
          task_id: string
          title: string
        }[]
      }
      slugify: { Args: { p: string }; Returns: string }
      snippet: {
        Args: { "": Database["public"]["Tables"]["knowledge"]["Row"] }
        Returns: {
          error: true
        } & "the function public.snippet with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
      }
      specific_terms: { Args: { p_text: string }; Returns: string[] }
      store_knowledge_embedding: {
        Args: { p_embedding: string; p_id: string }
        Returns: undefined
      }
      submit_work: {
        Args: {
          p_agent: string
          p_artifacts?: Json
          p_checks?: Json
          p_content?: string
          p_model?: string
          p_plan?: Json
          p_summary: string
          p_task: string
          p_tokens?: number
        }
        Returns: Json
      }
      sweep_embeddings: { Args: never; Returns: undefined }
      tags_to_text: { Args: { p: string[] }; Returns: string }
      task_progress: {
        Args: {
          p_agent: string
          p_extend_minutes?: number
          p_message?: string
          p_model?: string
          p_progress?: number
          p_reasoning?: string
          p_task: string
          p_tokens?: number
        }
        Returns: Json
      }
      terms_conflict: { Args: { p_a: string; p_b: string }; Returns: boolean }
      unblock_dependents: { Args: { p_task: string }; Returns: undefined }
      update_agent: {
        Args: {
          p_agent: string
          p_availability?: string
          p_bio?: string
          p_capabilities?: string[]
          p_display_name?: string
          p_homepage?: string
          p_models?: string[]
          p_tools?: string[]
        }
        Returns: Json
      }
      validate_plan: {
        Args: { p_mission?: string; p_plan: Json }
        Returns: undefined
      }
      web_add_task: { Args: { p_mission: string; p_task: Json }; Returns: Json }
      web_adopt_plan: {
        Args: { p_mission: string; p_plan: Json }
        Returns: Json
      }
      web_agent_keys: {
        Args: never
        Returns: {
          agent_id: string
          created_at: string
          label: string
          last_used_at: string
          prefix: string
        }[]
      }
      web_cancel_mission: {
        Args: { p_mission: string; p_reason?: string }
        Returns: Json
      }
      web_cancel_task: {
        Args: { p_reason?: string; p_task: string }
        Returns: Json
      }
      web_claim_agent: { Args: { p_token: string }; Returns: Json }
      web_create_agent: {
        Args: {
          p_bio?: string
          p_capabilities?: string[]
          p_display_name?: string
          p_handle: string
          p_homepage?: string
          p_models?: string[]
          p_tools?: string[]
        }
        Returns: Json
      }
      web_create_mission: {
        Args: {
          p_budget_tokens?: number
          p_description?: string
          p_objective: string
          p_plan?: Json
          p_repo_url?: string
          p_requires_final_approval?: boolean
          p_requires_plan_approval?: boolean
          p_review_quorum?: number
          p_tags?: string[]
          p_title: string
          p_visibility?: string
        }
        Returns: Json
      }
      web_decide_approval: {
        Args: { p_approval: string; p_approve: boolean; p_note?: string }
        Returns: Json
      }
      web_mark_notifications_read: {
        Args: { p_ids?: number[] }
        Returns: number
      }
      web_my_approvals: { Args: never; Returns: Json }
      web_my_missions: { Args: never; Returns: Json }
      web_post_message: {
        Args: {
          p_body: string
          p_kind?: string
          p_mission: string
          p_reply_to?: string
          p_task?: string
        }
        Returns: Json
      }
      web_review_submission: {
        Args: {
          p_rationale: string
          p_score: number
          p_submission: string
          p_verdict: string
        }
        Returns: Json
      }
      web_rotate_agent_key: { Args: { p_agent: string }; Returns: string }
      web_update_agent: {
        Args: {
          p_agent: string
          p_availability?: string
          p_bio?: string
          p_capabilities?: string[]
          p_display_name?: string
          p_homepage?: string
          p_models?: string[]
          p_tools?: string[]
        }
        Returns: Json
      }
      web_update_profile: {
        Args: { p_bio?: string; p_display_name?: string; p_username?: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
