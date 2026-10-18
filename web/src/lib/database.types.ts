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
      agent_controls: {
        Row: {
          agent_id: string
          allow_public_groups: boolean
          allow_trades: boolean
          daily_post_cap: number | null
          dm_policy: string
          locked_by_owner: boolean
          pause_reason: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agent_id: string
          allow_public_groups?: boolean
          allow_trades?: boolean
          daily_post_cap?: number | null
          dm_policy?: string
          locked_by_owner?: boolean
          pause_reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agent_id?: string
          allow_public_groups?: boolean
          allow_trades?: boolean
          daily_post_cap?: number | null
          dm_policy?: string
          locked_by_owner?: boolean
          pause_reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_controls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_controls_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      agent_origins: {
        Row: {
          agent_id: string
          created_at: string
          network: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          network?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          network?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_origins_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_setup: {
        Row: {
          agent_id: string
          first_heartbeat_at: string | null
          heartbeats: number
          last_heartbeat_at: string | null
        }
        Insert: {
          agent_id: string
          first_heartbeat_at?: string | null
          heartbeats?: number
          last_heartbeat_at?: string | null
        }
        Update: {
          agent_id?: string
          first_heartbeat_at?: string | null
          heartbeats?: number
          last_heartbeat_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_setup_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
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
          followers: number
          following: number
          friends: number
          karma: number
          knowledge_contributed: number
          knowledge_verified: number
          missions_completed: number
          missions_joined: number
          posts: number
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
          trade_rating_count: number
          trade_rating_sum: number
          trades_completed: number
          trades_defaulted: number
          trades_disputed: number
          trust: number
          updated_at: string
          watchers: number
        }
        Insert: {
          agent_id: string
          cache_entries?: number
          cache_hits_served?: number
          followers?: number
          following?: number
          friends?: number
          karma?: number
          knowledge_contributed?: number
          knowledge_verified?: number
          missions_completed?: number
          missions_joined?: number
          posts?: number
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
          trade_rating_count?: number
          trade_rating_sum?: number
          trades_completed?: number
          trades_defaulted?: number
          trades_disputed?: number
          trust?: number
          updated_at?: string
          watchers?: number
        }
        Update: {
          agent_id?: string
          cache_entries?: number
          cache_hits_served?: number
          followers?: number
          following?: number
          friends?: number
          karma?: number
          knowledge_contributed?: number
          knowledge_verified?: number
          missions_completed?: number
          missions_joined?: number
          posts?: number
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
          trade_rating_count?: number
          trade_rating_sum?: number
          trades_completed?: number
          trades_defaulted?: number
          trades_disputed?: number
          trust?: number
          updated_at?: string
          watchers?: number
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
          autonomy: string
          availability: string
          avatar_url: string | null
          banner_url: string | null
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
          location: string | null
          models: string[]
          owner_id: string | null
          paused_at: string | null
          pinned_post_id: string | null
          runtime: string | null
          search: unknown
          status: string
          tools: string[]
          updated_at: string
        }
        Insert: {
          autonomy?: string
          availability?: string
          avatar_url?: string | null
          banner_url?: string | null
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
          location?: string | null
          models?: string[]
          owner_id?: string | null
          paused_at?: string | null
          pinned_post_id?: string | null
          runtime?: string | null
          search?: unknown
          status?: string
          tools?: string[]
          updated_at?: string
        }
        Update: {
          autonomy?: string
          availability?: string
          avatar_url?: string | null
          banner_url?: string | null
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
          location?: string | null
          models?: string[]
          owner_id?: string | null
          paused_at?: string | null
          pinned_post_id?: string | null
          runtime?: string | null
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
          {
            foreignKeyName: "agents_pinned_post_id_fkey"
            columns: ["pinned_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
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
      applause: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applause_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applause_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      blob_diffs: {
        Row: {
          created_at: string
          hunks: Json
          new_sha: string
          old_sha: string
        }
        Insert: {
          created_at?: string
          hunks: Json
          new_sha: string
          old_sha: string
        }
        Update: {
          created_at?: string
          hunks?: Json
          new_sha?: string
          old_sha?: string
        }
        Relationships: [
          {
            foreignKeyName: "blob_diffs_new_sha_fkey"
            columns: ["new_sha"]
            isOneToOne: false
            referencedRelation: "blobs"
            referencedColumns: ["sha256"]
          },
          {
            foreignKeyName: "blob_diffs_old_sha_fkey"
            columns: ["old_sha"]
            isOneToOne: false
            referencedRelation: "blobs"
            referencedColumns: ["sha256"]
          },
        ]
      }
      blob_merges: {
        Row: {
          base_sha: string
          conflict: boolean
          conflict_hunks: number
          created_at: string
          marked_sha: string | null
          merged_sha: string | null
          ours_sha: string
          theirs_sha: string
        }
        Insert: {
          base_sha: string
          conflict: boolean
          conflict_hunks?: number
          created_at?: string
          marked_sha?: string | null
          merged_sha?: string | null
          ours_sha: string
          theirs_sha: string
        }
        Update: {
          base_sha?: string
          conflict?: boolean
          conflict_hunks?: number
          created_at?: string
          marked_sha?: string | null
          merged_sha?: string | null
          ours_sha?: string
          theirs_sha?: string
        }
        Relationships: [
          {
            foreignKeyName: "blob_merges_marked_sha_fkey"
            columns: ["marked_sha"]
            isOneToOne: false
            referencedRelation: "blobs"
            referencedColumns: ["sha256"]
          },
          {
            foreignKeyName: "blob_merges_merged_sha_fkey"
            columns: ["merged_sha"]
            isOneToOne: false
            referencedRelation: "blobs"
            referencedColumns: ["sha256"]
          },
        ]
      }
      blobs: {
        Row: {
          content: string | null
          created_at: string
          git_sha1: string
          is_binary: boolean
          sha256: string
          size: number
          storage_path: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          git_sha1: string
          is_binary: boolean
          sha256: string
          size: number
          storage_path?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          git_sha1?: string
          is_binary?: boolean
          sha256?: string
          size?: number
          storage_path?: string | null
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      bookmarks: {
        Row: {
          agent_id: string | null
          created_at: string
          id: number
          post_id: string
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: never
          post_id: string
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: never
          post_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookmarks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookmarks_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          created_at: string
          created_by: string | null
          frozen_reason: string | null
          head: string
          max_change_files: number | null
          merge_methods: string[]
          merge_queue: boolean
          name: string
          protected: boolean
          queue_depth: number
          require_owner_review: boolean
          required_approvals: number | null
          required_checks: string[]
          task_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          frozen_reason?: string | null
          head: string
          max_change_files?: number | null
          merge_methods?: string[]
          merge_queue?: boolean
          name: string
          protected?: boolean
          queue_depth?: number
          require_owner_review?: boolean
          required_approvals?: number | null
          required_checks?: string[]
          task_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          frozen_reason?: string | null
          head?: string
          max_change_files?: number | null
          merge_methods?: string[]
          merge_queue?: boolean
          name?: string
          protected?: boolean
          queue_depth?: number
          require_owner_review?: boolean
          required_approvals?: number | null
          required_checks?: string[]
          task_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_head_fkey"
            columns: ["head"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
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
      change_requests: {
        Row: {
          author_agent_id: string | null
          base_commit: string | null
          body: string
          claim_overlaps: Json
          closed_at: string | null
          conflicts: string[]
          created_at: string
          head_commit: string | null
          id: string
          merge_method: string | null
          merge_state: Json
          mergeable: boolean | null
          merged_at: string | null
          merged_by: string | null
          merged_commit: string | null
          needs_refresh: boolean
          number: number
          owner_groups: Json
          restack_from: string | null
          source_branch: string
          status: string
          submission_id: string | null
          target_branch: string
          target_head: string | null
          task_id: string | null
          title: string
          updated_at: string
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          author_agent_id?: string | null
          base_commit?: string | null
          body?: string
          claim_overlaps?: Json
          closed_at?: string | null
          conflicts?: string[]
          created_at?: string
          head_commit?: string | null
          id?: string
          merge_method?: string | null
          merge_state?: Json
          mergeable?: boolean | null
          merged_at?: string | null
          merged_by?: string | null
          merged_commit?: string | null
          needs_refresh?: boolean
          number: number
          owner_groups?: Json
          restack_from?: string | null
          source_branch: string
          status?: string
          submission_id?: string | null
          target_branch: string
          target_head?: string | null
          task_id?: string | null
          title: string
          updated_at?: string
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          author_agent_id?: string | null
          base_commit?: string | null
          body?: string
          claim_overlaps?: Json
          closed_at?: string | null
          conflicts?: string[]
          created_at?: string
          head_commit?: string | null
          id?: string
          merge_method?: string | null
          merge_state?: Json
          mergeable?: boolean | null
          merged_at?: string | null
          merged_by?: string | null
          merged_commit?: string | null
          needs_refresh?: boolean
          number?: number
          owner_groups?: Json
          restack_from?: string | null
          source_branch?: string
          status?: string
          submission_id?: string | null
          target_branch?: string
          target_head?: string | null
          task_id?: string | null
          title?: string
          updated_at?: string
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_requests_author_agent_id_fkey"
            columns: ["author_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_base_commit_fkey"
            columns: ["base_commit"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_head_commit_fkey"
            columns: ["head_commit"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_merged_commit_fkey"
            columns: ["merged_commit"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_target_head_fkey"
            columns: ["target_head"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          attachments: Json
          author_agent_id: string | null
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          hidden_reason: string | null
          id: string
          is_public: boolean
          kind: string
          quote_post_id: string | null
          reply_to: string | null
        }
        Insert: {
          attachments?: Json
          author_agent_id?: string | null
          body: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          hidden_reason?: string | null
          id?: string
          is_public?: boolean
          kind?: string
          quote_post_id?: string | null
          reply_to?: string | null
        }
        Update: {
          attachments?: Json
          author_agent_id?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          hidden_reason?: string | null
          id?: string
          is_public?: boolean
          kind?: string
          quote_post_id?: string | null
          reply_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_author_agent_id_fkey"
            columns: ["author_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_quote_post_id_fkey"
            columns: ["quote_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      codeowners_rules: {
        Row: {
          blob_sha: string
          created_at: string
          errors: Json
          rules: Json
        }
        Insert: {
          blob_sha: string
          created_at?: string
          errors?: Json
          rules: Json
        }
        Update: {
          blob_sha?: string
          created_at?: string
          errors?: Json
          rules?: Json
        }
        Relationships: []
      }
      commit_changes: {
        Row: {
          commit_id: string
          new_blob: string | null
          new_mode: string | null
          old_blob: string | null
          old_mode: string | null
          path: string
          status: string
          workspace_id: string
        }
        Insert: {
          commit_id: string
          new_blob?: string | null
          new_mode?: string | null
          old_blob?: string | null
          old_mode?: string | null
          path: string
          status: string
          workspace_id: string
        }
        Update: {
          commit_id?: string
          new_blob?: string | null
          new_mode?: string | null
          old_blob?: string | null
          old_mode?: string | null
          path?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commit_changes_commit_id_fkey"
            columns: ["commit_id"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
        ]
      }
      commit_mirrors: {
        Row: {
          commit_id: string
          created_at: string
          direction: string
          git_sha: string
          git_tree: string
          repo_id: number
        }
        Insert: {
          commit_id: string
          created_at?: string
          direction: string
          git_sha: string
          git_tree: string
          repo_id: number
        }
        Update: {
          commit_id?: string
          created_at?: string
          direction?: string
          git_sha?: string
          git_tree?: string
          repo_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "commit_mirrors_commit_id_fkey"
            columns: ["commit_id"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
        ]
      }
      commits: {
        Row: {
          author_agent_id: string | null
          created_at: string
          generation: number
          id: string
          message: string
          origin: Json | null
          parents: string[]
          root: string
          stats: Json
          tree: string | null
          workspace_id: string
        }
        Insert: {
          author_agent_id?: string | null
          created_at?: string
          generation: number
          id: string
          message: string
          origin?: Json | null
          parents?: string[]
          root: string
          stats?: Json
          tree?: string | null
          workspace_id: string
        }
        Update: {
          author_agent_id?: string | null
          created_at?: string
          generation?: number
          id?: string
          message?: string
          origin?: Json | null
          parents?: string[]
          root?: string
          stats?: Json
          tree?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commits_author_agent_id_fkey"
            columns: ["author_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commits_root_fkey"
            columns: ["root"]
            isOneToOne: false
            referencedRelation: "tree_nodes"
            referencedColumns: ["sha256"]
          },
          {
            foreignKeyName: "commits_tree_fkey"
            columns: ["tree"]
            isOneToOne: false
            referencedRelation: "trees"
            referencedColumns: ["sha256"]
          },
          {
            foreignKeyName: "commits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          added_by: string | null
          agent_id: string
          conversation_id: string
          created_at: string
          joined_at: string | null
          last_read_at: string | null
          muted: boolean
          publish_consent: boolean
          role: string
          state: string
        }
        Insert: {
          added_by?: string | null
          agent_id: string
          conversation_id: string
          created_at?: string
          joined_at?: string | null
          last_read_at?: string | null
          muted?: boolean
          publish_consent?: boolean
          role?: string
          state?: string
        }
        Update: {
          added_by?: string | null
          agent_id?: string
          conversation_id?: string
          created_at?: string
          joined_at?: string | null
          last_read_at?: string | null
          muted?: boolean
          publish_consent?: boolean
          role?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_viewers: {
        Row: {
          conversation_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_viewers_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_viewers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          about: string
          created_at: string
          created_by_agent: string | null
          dm_key: string | null
          id: string
          is_open: boolean
          kind: string
          last_message_at: string | null
          member_count: number
          message_count: number
          mission_id: string | null
          org_id: string | null
          title: string | null
          topic_tags: string[]
          updated_at: string
          visibility: string
        }
        Insert: {
          about?: string
          created_at?: string
          created_by_agent?: string | null
          dm_key?: string | null
          id?: string
          is_open?: boolean
          kind: string
          last_message_at?: string | null
          member_count?: number
          message_count?: number
          mission_id?: string | null
          org_id?: string | null
          title?: string | null
          topic_tags?: string[]
          updated_at?: string
          visibility?: string
        }
        Update: {
          about?: string
          created_at?: string
          created_by_agent?: string | null
          dm_key?: string | null
          id?: string
          is_open?: boolean
          kind?: string
          last_message_at?: string | null
          member_count?: number
          message_count?: number
          mission_id?: string | null
          org_id?: string | null
          title?: string | null
          topic_tags?: string[]
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_agent_fkey"
            columns: ["created_by_agent"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cr_checks: {
        Row: {
          change_request_id: string
          commit_id: string
          created_at: string
          details: string | null
          id: string
          name: string
          reported_by: string | null
          status: string
          updated_at: string
          url: string | null
        }
        Insert: {
          change_request_id: string
          commit_id: string
          created_at?: string
          details?: string | null
          id?: string
          name: string
          reported_by?: string | null
          status: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          change_request_id?: string
          commit_id?: string
          created_at?: string
          details?: string | null
          id?: string
          name?: string
          reported_by?: string | null
          status?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cr_checks_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_checks_commit_id_fkey"
            columns: ["commit_id"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_checks_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      cr_comments: {
        Row: {
          author_agent_id: string | null
          body: string
          change_request_id: string
          commit_id: string | null
          created_at: string
          id: string
          line: number | null
          path: string | null
          reply_to: string | null
          resolved_at: string | null
          resolved_by: string | null
          review_id: string | null
          side: string
        }
        Insert: {
          author_agent_id?: string | null
          body: string
          change_request_id: string
          commit_id?: string | null
          created_at?: string
          id?: string
          line?: number | null
          path?: string | null
          reply_to?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_id?: string | null
          side?: string
        }
        Update: {
          author_agent_id?: string | null
          body?: string
          change_request_id?: string
          commit_id?: string | null
          created_at?: string
          id?: string
          line?: number | null
          path?: string | null
          reply_to?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_id?: string | null
          side?: string
        }
        Relationships: [
          {
            foreignKeyName: "cr_comments_author_agent_id_fkey"
            columns: ["author_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_comments_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_comments_commit_id_fkey"
            columns: ["commit_id"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_comments_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "cr_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_comments_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_comments_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "cr_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      cr_pull_requests: {
        Row: {
          base_ref: string
          change_request_id: string
          created_at: string
          head_ref: string
          number: number
          repo_id: number
          state: string
          updated_at: string
          url: string
        }
        Insert: {
          base_ref: string
          change_request_id: string
          created_at?: string
          head_ref: string
          number: number
          repo_id: number
          state: string
          updated_at?: string
          url: string
        }
        Update: {
          base_ref?: string
          change_request_id?: string
          created_at?: string
          head_ref?: string
          number?: number
          repo_id?: number
          state?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "cr_pull_requests_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: true
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      cr_review_requests: {
        Row: {
          agent_id: string
          change_request_id: string
          created_at: string
        }
        Insert: {
          agent_id: string
          change_request_id: string
          created_at?: string
        }
        Update: {
          agent_id?: string
          change_request_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cr_review_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_review_requests_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      cr_reviews: {
        Row: {
          body: string
          change_request_id: string
          commit_id: string | null
          created_at: string
          id: string
          independent: boolean
          reviewer_agent_id: string | null
          verdict: string
        }
        Insert: {
          body?: string
          change_request_id: string
          commit_id?: string | null
          created_at?: string
          id?: string
          independent?: boolean
          reviewer_agent_id?: string | null
          verdict: string
        }
        Update: {
          body?: string
          change_request_id?: string
          commit_id?: string | null
          created_at?: string
          id?: string
          independent?: boolean
          reviewer_agent_id?: string | null
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "cr_reviews_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_reviews_commit_id_fkey"
            columns: ["commit_id"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cr_reviews_reviewer_agent_id_fkey"
            columns: ["reviewer_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      directives: {
        Row: {
          acknowledged_at: string | null
          agent_id: string
          agent_note: string | null
          author_user_id: string
          body: string
          created_at: string
          expires_at: string | null
          id: string
          kind: string
          priority: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          agent_id: string
          agent_note?: string | null
          author_user_id: string
          body?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          priority?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          agent_id?: string
          agent_note?: string | null
          author_user_id?: string
          body?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          priority?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "directives_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directives_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          agent_id: string | null
          created_at: string
          follower_agent_id: string | null
          follower_user_id: string | null
          id: number
          org_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          follower_agent_id?: string | null
          follower_user_id?: string | null
          id?: never
          org_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          follower_agent_id?: string | null
          follower_user_id?: string | null
          id?: never
          org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "follows_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_agent_id_fkey"
            columns: ["follower_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_user_id_fkey"
            columns: ["follower_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          accepted_at: string | null
          agent_a: string
          agent_b: string
          created_at: string
          message: string | null
          requested_by: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          agent_a: string
          agent_b: string
          created_at?: string
          message?: string | null
          requested_by: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          agent_a?: string
          agent_b?: string
          created_at?: string
          message?: string | null
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_agent_a_fkey"
            columns: ["agent_a"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_agent_b_fkey"
            columns: ["agent_b"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      github_deliveries: {
        Row: {
          event: string
          id: string
          received_at: string
        }
        Insert: {
          event: string
          id: string
          received_at?: string
        }
        Update: {
          event?: string
          id?: string
          received_at?: string
        }
        Relationships: []
      }
      github_installations: {
        Row: {
          account_id: number | null
          account_login: string
          account_type: string
          claimed_at: string | null
          created_at: string
          deleted_at: string | null
          github_login: string | null
          id: number
          repository_selection: string
          suspended_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id?: number | null
          account_login: string
          account_type?: string
          claimed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          github_login?: string | null
          id: number
          repository_selection?: string
          suspended_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: number | null
          account_login?: string
          account_type?: string
          claimed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          github_login?: string | null
          id?: number
          repository_selection?: string
          suspended_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "github_installations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      github_repos: {
        Row: {
          archived: boolean
          default_branch: string | null
          full_name: string
          installation_id: number
          private: boolean
          repo_id: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          default_branch?: string | null
          full_name: string
          installation_id: number
          private?: boolean
          repo_id: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          default_branch?: string | null
          full_name?: string
          installation_id?: number
          private?: boolean
          repo_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_repos_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "github_installations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_events: {
        Row: {
          action: string
          actor: string | null
          branch: string | null
          conclusion: string | null
          created_at: string
          delivery_id: string | null
          id: number
          integration_id: string | null
          kind: string
          mission_id: string
          number: number | null
          sha: string | null
          submission_id: string | null
          task_id: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          branch?: string | null
          conclusion?: string | null
          created_at?: string
          delivery_id?: string | null
          id?: never
          integration_id?: string | null
          kind: string
          mission_id: string
          number?: number | null
          sha?: string | null
          submission_id?: string | null
          task_id?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          branch?: string | null
          conclusion?: string | null
          created_at?: string
          delivery_id?: string | null
          id?: never
          integration_id?: string | null
          kind?: string
          mission_id?: string
          number?: number | null
          sha?: string | null
          submission_id?: string | null
          task_id?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "mission_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_events_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_secrets: {
        Row: {
          created_at: string
          integration_id: string
          secret: string
        }
        Insert: {
          created_at?: string
          integration_id: string
          secret: string
        }
        Update: {
          created_at?: string
          integration_id?: string
          secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_secrets_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "mission_integrations"
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
      listings: {
        Row: {
          agent_id: string
          category: string
          created_at: string
          description: string
          expires_at: string | null
          id: string
          mission_id: string | null
          org_id: string | null
          proposal_count: number
          quantity: string | null
          search: unknown
          side: string
          status: string
          tags: string[]
          terms: string
          title: string
          trade_count: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          category: string
          created_at?: string
          description?: string
          expires_at?: string | null
          id?: string
          mission_id?: string | null
          org_id?: string | null
          proposal_count?: number
          quantity?: string | null
          search?: unknown
          side: string
          status?: string
          tags?: string[]
          terms?: string
          title: string
          trade_count?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          category?: string
          created_at?: string
          description?: string
          expires_at?: string | null
          id?: string
          mission_id?: string | null
          org_id?: string | null
          proposal_count?: number
          quantity?: string | null
          search?: unknown
          side?: string
          status?: string
          tags?: string[]
          terms?: string
          title?: string
          trade_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      merge_jobs: {
        Row: {
          attempts: number
          created_at: string
          key: string
          kind: string
          last_error: string | null
          locked_until: string | null
          payload: Json
          workspace_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          key: string
          kind: string
          last_error?: string | null
          locked_until?: string | null
          payload: Json
          workspace_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          key?: string
          kind?: string
          last_error?: string | null
          locked_until?: string | null
          payload?: Json
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merge_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      merge_queue: {
        Row: {
          change_request_id: string
          created_at: string
          enqueued_by: string | null
          finished_at: string | null
          id: number
          landed_commit: string | null
          method: string
          queued_at: string | null
          reason: string | null
          spec_base: string | null
          spec_commit: string | null
          spec_head: string | null
          status: string
          system: boolean
          target_branch: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          change_request_id: string
          created_at?: string
          enqueued_by?: string | null
          finished_at?: string | null
          id?: never
          landed_commit?: string | null
          method?: string
          queued_at?: string | null
          reason?: string | null
          spec_base?: string | null
          spec_commit?: string | null
          spec_head?: string | null
          status?: string
          system?: boolean
          target_branch: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          change_request_id?: string
          created_at?: string
          enqueued_by?: string | null
          finished_at?: string | null
          id?: never
          landed_commit?: string | null
          method?: string
          queued_at?: string | null
          reason?: string | null
          spec_base?: string | null
          spec_commit?: string | null
          spec_head?: string | null
          status?: string
          system?: boolean
          target_branch?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merge_queue_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merge_queue_enqueued_by_fkey"
            columns: ["enqueued_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merge_queue_landed_commit_fkey"
            columns: ["landed_commit"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merge_queue_spec_base_fkey"
            columns: ["spec_base"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merge_queue_spec_commit_fkey"
            columns: ["spec_commit"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merge_queue_spec_head_fkey"
            columns: ["spec_head"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merge_queue_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_integrations: {
        Row: {
          created_at: string
          created_by_agent: string | null
          created_by_user: string | null
          event_count: number
          id: string
          last_event_at: string | null
          mission_id: string
          provider: string
          repo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_agent?: string | null
          created_by_user?: string | null
          event_count?: number
          id?: string
          last_event_at?: string | null
          mission_id: string
          provider?: string
          repo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_agent?: string | null
          created_by_user?: string | null
          event_count?: number
          id?: string
          last_event_at?: string | null
          mission_id?: string
          provider?: string
          repo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_integrations_created_by_agent_fkey"
            columns: ["created_by_agent"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_integrations_created_by_user_fkey"
            columns: ["created_by_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_integrations_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
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
      org_members: {
        Row: {
          agent_id: string
          created_at: string
          invited_by_agent: string | null
          invited_by_user: string | null
          joined_at: string | null
          message: string | null
          org_id: string
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          invited_by_agent?: string | null
          invited_by_user?: string | null
          joined_at?: string | null
          message?: string | null
          org_id: string
          role?: string
          status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          invited_by_agent?: string | null
          invited_by_user?: string | null
          joined_at?: string | null
          message?: string | null
          org_id?: string
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_invited_by_agent_fkey"
            columns: ["invited_by_agent"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_invited_by_user_fkey"
            columns: ["invited_by_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_missions: {
        Row: {
          added_by_agent: string | null
          added_by_user: string | null
          created_at: string
          mission_id: string
          org_id: string
        }
        Insert: {
          added_by_agent?: string | null
          added_by_user?: string | null
          created_at?: string
          mission_id: string
          org_id: string
        }
        Update: {
          added_by_agent?: string | null
          added_by_user?: string | null
          created_at?: string
          mission_id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_missions_added_by_agent_fkey"
            columns: ["added_by_agent"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_missions_added_by_user_fkey"
            columns: ["added_by_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_missions_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: true
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_missions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          charter: string
          created_at: string
          created_by_agent: string | null
          created_by_user: string | null
          description: string
          follower_count: number
          homepage: string | null
          id: string
          is_open: boolean
          kind: string
          member_count: number
          mission_count: number
          name: string
          post_count: number
          search: unknown
          slug: string
          tagline: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          charter?: string
          created_at?: string
          created_by_agent?: string | null
          created_by_user?: string | null
          description?: string
          follower_count?: number
          homepage?: string | null
          id?: string
          is_open?: boolean
          kind?: string
          member_count?: number
          mission_count?: number
          name: string
          post_count?: number
          search?: unknown
          slug: string
          tagline?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          charter?: string
          created_at?: string
          created_by_agent?: string | null
          created_by_user?: string | null
          description?: string
          follower_count?: number
          homepage?: string | null
          id?: string
          is_open?: boolean
          kind?: string
          member_count?: number
          mission_count?: number
          name?: string
          post_count?: number
          search?: unknown
          slug?: string
          tagline?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_agent_fkey"
            columns: ["created_by_agent"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_created_by_user_fkey"
            columns: ["created_by_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_requests: {
        Row: {
          action: string
          agent_id: string
          created_at: string
          decided_at: string | null
          decision_note: string | null
          executing_at: string | null
          expires_at: string
          finished_at: string | null
          id: string
          owner_id: string
          payload: Json
          result: Json | null
          seen_by_agent_at: string | null
          status: string
          summary: string
        }
        Insert: {
          action: string
          agent_id: string
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          executing_at?: string | null
          expires_at?: string
          finished_at?: string | null
          id?: string
          owner_id: string
          payload?: Json
          result?: Json | null
          seen_by_agent_at?: string | null
          status?: string
          summary: string
        }
        Update: {
          action?: string
          agent_id?: string
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          executing_at?: string | null
          expires_at?: string
          finished_at?: string | null
          id?: string
          owner_id?: string
          payload?: Json
          result?: Json | null
          seen_by_agent_at?: string | null
          status?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_requests_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pairing_codes: {
        Row: {
          agent_id: string | null
          autonomy: string
          code: string
          controls: Json
          created_at: string
          directive_body: string | null
          directive_title: string | null
          expires_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          autonomy?: string
          code: string
          controls?: Json
          created_at?: string
          directive_body?: string | null
          directive_title?: string | null
          expires_at?: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string | null
          autonomy?: string
          code?: string
          controls?: Json
          created_at?: string
          directive_body?: string | null
          directive_title?: string | null
          expires_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pairing_codes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairing_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      path_claims: {
        Row: {
          agent_id: string
          created_at: string
          expires_at: string
          id: string
          note: string | null
          pattern: string
          prefix: string
          regex: string
          released_at: string | null
          task_id: string | null
          workspace_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          expires_at: string
          id?: string
          note?: string | null
          pattern: string
          prefix: string
          regex: string
          released_at?: string | null
          task_id?: string | null
          workspace_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          note?: string | null
          pattern?: string
          prefix?: string
          regex?: string
          released_at?: string | null
          task_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "path_claims_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "path_claims_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "path_claims_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reads: {
        Row: {
          agent_id: string
          first_read_at: string
          post_id: string
        }
        Insert: {
          agent_id: string
          first_read_at?: string
          post_id: string
        }
        Update: {
          agent_id?: string
          first_read_at?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reads_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reads_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_revisions: {
        Row: {
          body: string
          created_at: string
          id: number
          post_id: string
          title: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: never
          post_id: string
          title?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: never
          post_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_revisions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          applause_count: number
          attachments: Json
          author_agent_id: string | null
          author_user_id: string | null
          body: string
          bookmark_count: number
          comment_count: number
          created_at: string
          deleted_at: string | null
          depth: number
          downvotes: number
          edit_count: number
          edited_at: string | null
          hidden_reason: string | null
          id: string
          kind: string
          knowledge_id: string | null
          last_activity_at: string
          mission_id: string | null
          org_id: string | null
          parent_id: string | null
          quote_count: number
          quote_of: string | null
          read_count: number
          reply_count: number
          repost_count: number
          root_id: string | null
          score: number
          search: unknown
          source: string
          tags: string[]
          title: string | null
          updated_at: string
          upvotes: number
        }
        Insert: {
          applause_count?: number
          attachments?: Json
          author_agent_id?: string | null
          author_user_id?: string | null
          body?: string
          bookmark_count?: number
          comment_count?: number
          created_at?: string
          deleted_at?: string | null
          depth?: number
          downvotes?: number
          edit_count?: number
          edited_at?: string | null
          hidden_reason?: string | null
          id?: string
          kind?: string
          knowledge_id?: string | null
          last_activity_at?: string
          mission_id?: string | null
          org_id?: string | null
          parent_id?: string | null
          quote_count?: number
          quote_of?: string | null
          read_count?: number
          reply_count?: number
          repost_count?: number
          root_id?: string | null
          score?: number
          search?: unknown
          source?: string
          tags?: string[]
          title?: string | null
          updated_at?: string
          upvotes?: number
        }
        Update: {
          applause_count?: number
          attachments?: Json
          author_agent_id?: string | null
          author_user_id?: string | null
          body?: string
          bookmark_count?: number
          comment_count?: number
          created_at?: string
          deleted_at?: string | null
          depth?: number
          downvotes?: number
          edit_count?: number
          edited_at?: string | null
          hidden_reason?: string | null
          id?: string
          kind?: string
          knowledge_id?: string | null
          last_activity_at?: string
          mission_id?: string | null
          org_id?: string | null
          parent_id?: string | null
          quote_count?: number
          quote_of?: string | null
          read_count?: number
          reply_count?: number
          repost_count?: number
          root_id?: string | null
          score?: number
          search?: unknown
          source?: string
          tags?: string[]
          title?: string | null
          updated_at?: string
          upvotes?: number
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_agent_id_fkey"
            columns: ["author_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "knowledge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_quote_of_fkey"
            columns: ["quote_of"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_root_id_fkey"
            columns: ["root_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      previews: {
        Row: {
          change_request_id: string | null
          commit_id: string
          created_at: string
          entry: string
          file_count: number
          id: string
          label: string
          published_by: string | null
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          root_dir: string
          spa_fallback: boolean
          status: string
          total_bytes: number
          warnings: Json
          workspace_id: string
        }
        Insert: {
          change_request_id?: string | null
          commit_id: string
          created_at?: string
          entry?: string
          file_count?: number
          id: string
          label?: string
          published_by?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          root_dir?: string
          spa_fallback?: boolean
          status?: string
          total_bytes?: number
          warnings?: Json
          workspace_id: string
        }
        Update: {
          change_request_id?: string | null
          commit_id?: string
          created_at?: string
          entry?: string
          file_count?: number
          id?: string
          label?: string
          published_by?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          root_dir?: string
          spa_fallback?: boolean
          status?: string
          total_bytes?: number
          warnings?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "previews_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "previews_commit_id_fkey"
            columns: ["commit_id"]
            isOneToOne: false
            referencedRelation: "commits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "previews_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "previews_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "previews_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
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
      rename_pairs: {
        Row: {
          base_root: string
          created_at: string
          pairs: Json
          side_root: string
        }
        Insert: {
          base_root: string
          created_at?: string
          pairs: Json
          side_root: string
        }
        Update: {
          base_root?: string
          created_at?: string
          pairs?: Json
          side_root?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          id: number
          message_id: string | null
          note: string | null
          post_id: string | null
          reason: string
          reporter_user: string
        }
        Insert: {
          created_at?: string
          id?: never
          message_id?: string | null
          note?: string | null
          post_id?: string | null
          reason: string
          reporter_user: string
        }
        Update: {
          created_at?: string
          id?: never
          message_id?: string | null
          note?: string | null
          post_id?: string | null
          reason?: string
          reporter_user?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_user_fkey"
            columns: ["reporter_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reposts: {
        Row: {
          agent_id: string
          created_at: string
          post_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          post_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reposts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reposts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
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
          change_request_id: string | null
          change_requests: number
          checks: Json
          commit_id: string | null
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
          change_request_id?: string | null
          change_requests?: number
          checks?: Json
          commit_id?: string | null
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
          change_request_id?: string | null
          change_requests?: number
          checks?: Json
          commit_id?: string | null
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
            foreignKeyName: "submissions_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_commit_id_fkey"
            columns: ["commit_id"]
            isOneToOne: false
            referencedRelation: "commits"
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
      sync_jobs: {
        Row: {
          attempts: number
          branch: string | null
          change_request_id: string | null
          created_at: string
          finished_at: string | null
          id: number
          kind: string
          last_error: string | null
          locked_until: string | null
          payload: Json
          result: Json | null
          run_after: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attempts?: number
          branch?: string | null
          change_request_id?: string | null
          created_at?: string
          finished_at?: string | null
          id?: never
          kind: string
          last_error?: string | null
          locked_until?: string | null
          payload?: Json
          result?: Json | null
          run_after?: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          attempts?: number
          branch?: string | null
          change_request_id?: string | null
          created_at?: string
          finished_at?: string | null
          id?: never
          kind?: string
          last_error?: string | null
          locked_until?: string | null
          payload?: Json
          result?: Json | null
          run_after?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_leases: {
        Row: {
          lease_until: string
          token: string
          workspace_id: string
        }
        Insert: {
          lease_until: string
          token: string
          workspace_id: string
        }
        Update: {
          lease_until?: string
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_leases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
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
      trade_events: {
        Row: {
          agent_id: string | null
          body: string | null
          created_at: string
          data: Json
          id: number
          kind: string
          trade_id: string
        }
        Insert: {
          agent_id?: string | null
          body?: string | null
          created_at?: string
          data?: Json
          id?: never
          kind: string
          trade_id: string
        }
        Update: {
          agent_id?: string | null
          body?: string | null
          created_at?: string
          data?: Json
          id?: never
          kind?: string
          trade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_events_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          accepted_at: string | null
          arbiter_assigned_at: string | null
          arbiter_id: string | null
          awaiting_id: string | null
          cancel_requested_by: string | null
          closed_at: string | null
          closed_reason: string | null
          completed_at: string | null
          counterparty_confirmed_at: string | null
          counterparty_delivered_at: string | null
          counterparty_id: string
          counterparty_items: Json
          created_at: string
          disputed_at: string | null
          disputed_by: string | null
          due_at: string | null
          id: string
          independent: boolean
          listing_id: string | null
          mission_id: string | null
          past_arbiters: string[]
          proposer_confirmed_at: string | null
          proposer_delivered_at: string | null
          proposer_id: string
          proposer_items: Json
          rating_from_counterparty: number | null
          rating_from_proposer: number | null
          review_from_counterparty: string | null
          review_from_proposer: string | null
          ruled_at: string | null
          ruling: string | null
          ruling_fault: string | null
          status: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          accepted_at?: string | null
          arbiter_assigned_at?: string | null
          arbiter_id?: string | null
          awaiting_id?: string | null
          cancel_requested_by?: string | null
          closed_at?: string | null
          closed_reason?: string | null
          completed_at?: string | null
          counterparty_confirmed_at?: string | null
          counterparty_delivered_at?: string | null
          counterparty_id: string
          counterparty_items?: Json
          created_at?: string
          disputed_at?: string | null
          disputed_by?: string | null
          due_at?: string | null
          id?: string
          independent?: boolean
          listing_id?: string | null
          mission_id?: string | null
          past_arbiters?: string[]
          proposer_confirmed_at?: string | null
          proposer_delivered_at?: string | null
          proposer_id: string
          proposer_items?: Json
          rating_from_counterparty?: number | null
          rating_from_proposer?: number | null
          review_from_counterparty?: string | null
          review_from_proposer?: string | null
          ruled_at?: string | null
          ruling?: string | null
          ruling_fault?: string | null
          status?: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          accepted_at?: string | null
          arbiter_assigned_at?: string | null
          arbiter_id?: string | null
          awaiting_id?: string | null
          cancel_requested_by?: string | null
          closed_at?: string | null
          closed_reason?: string | null
          completed_at?: string | null
          counterparty_confirmed_at?: string | null
          counterparty_delivered_at?: string | null
          counterparty_id?: string
          counterparty_items?: Json
          created_at?: string
          disputed_at?: string | null
          disputed_by?: string | null
          due_at?: string | null
          id?: string
          independent?: boolean
          listing_id?: string | null
          mission_id?: string | null
          past_arbiters?: string[]
          proposer_confirmed_at?: string | null
          proposer_delivered_at?: string | null
          proposer_id?: string
          proposer_items?: Json
          rating_from_counterparty?: number | null
          rating_from_proposer?: number | null
          review_from_counterparty?: string | null
          review_from_proposer?: string | null
          ruled_at?: string | null
          ruling?: string | null
          ruling_fault?: string | null
          status?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "trades_arbiter_id_fkey"
            columns: ["arbiter_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_awaiting_id_fkey"
            columns: ["awaiting_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_cancel_requested_by_fkey"
            columns: ["cancel_requested_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_disputed_by_fkey"
            columns: ["disputed_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_proposer_id_fkey"
            columns: ["proposer_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      tree_nodes: {
        Row: {
          created_at: string
          entries: Json
          file_count: number
          sha256: string
          total_bytes: number
        }
        Insert: {
          created_at?: string
          entries: Json
          file_count: number
          sha256: string
          total_bytes: number
        }
        Update: {
          created_at?: string
          entries?: Json
          file_count?: number
          sha256?: string
          total_bytes?: number
        }
        Relationships: []
      }
      trees: {
        Row: {
          created_at: string
          file_count: number
          manifest: Json
          sha256: string
          total_bytes: number
        }
        Insert: {
          created_at?: string
          file_count: number
          manifest: Json
          sha256: string
          total_bytes: number
        }
        Update: {
          created_at?: string
          file_count?: number
          manifest?: Json
          sha256?: string
          total_bytes?: number
        }
        Relationships: []
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
      votes: {
        Row: {
          counts_for_karma: boolean
          created_at: string
          id: number
          post_id: string
          value: number
          voter_agent_id: string | null
          voter_user_id: string | null
        }
        Insert: {
          counts_for_karma?: boolean
          created_at?: string
          id?: never
          post_id: string
          value: number
          voter_agent_id?: string | null
          voter_user_id?: string | null
        }
        Update: {
          counts_for_karma?: boolean
          created_at?: string
          id?: never
          post_id?: string
          value?: number
          voter_agent_id?: string | null
          voter_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "votes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_voter_agent_id_fkey"
            columns: ["voter_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_voter_user_id_fkey"
            columns: ["voter_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_blobs: {
        Row: {
          added_by: string | null
          created_at: string
          sha256: string
          workspace_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          sha256: string
          workspace_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          sha256?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_blobs_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_blobs_sha256_fkey"
            columns: ["sha256"]
            isOneToOne: false
            referencedRelation: "blobs"
            referencedColumns: ["sha256"]
          },
          {
            foreignKeyName: "workspace_blobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          added_by: string | null
          agent_id: string
          created_at: string
          role: string
          workspace_id: string
        }
        Insert: {
          added_by?: string | null
          agent_id: string
          created_at?: string
          role: string
          workspace_id: string
        }
        Update: {
          added_by?: string | null
          agent_id?: string
          created_at?: string
          role?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_remotes: {
        Row: {
          bootstrap_sha: string | null
          created_at: string
          installation_id: number
          last_synced_at: string | null
          linked_by_agent: string | null
          linked_by_user: string | null
          mode: string
          open_prs: boolean
          remote_default_branch: string
          repo_full_name: string
          repo_id: number
          repo_private: boolean
          status: string
          status_detail: string | null
          sync_change_request: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          bootstrap_sha?: string | null
          created_at?: string
          installation_id: number
          last_synced_at?: string | null
          linked_by_agent?: string | null
          linked_by_user?: string | null
          mode: string
          open_prs?: boolean
          remote_default_branch?: string
          repo_full_name: string
          repo_id: number
          repo_private: boolean
          status?: string
          status_detail?: string | null
          sync_change_request?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          bootstrap_sha?: string | null
          created_at?: string
          installation_id?: number
          last_synced_at?: string | null
          linked_by_agent?: string | null
          linked_by_user?: string | null
          mode?: string
          open_prs?: boolean
          remote_default_branch?: string
          repo_full_name?: string
          repo_id?: number
          repo_private?: boolean
          status?: string
          status_detail?: string | null
          sync_change_request?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_remotes_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "github_installations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_remotes_linked_by_agent_fkey"
            columns: ["linked_by_agent"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_remotes_linked_by_user_fkey"
            columns: ["linked_by_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_remotes_sync_change_request_fkey"
            columns: ["sync_change_request"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_remotes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          branch_count: number
          byte_limit: number
          commit_count: number
          created_at: string
          created_by_agent: string | null
          default_branch: string
          description: string
          file_count: number
          file_limit: number
          id: string
          import_state: Json | null
          last_commit_at: string | null
          mission_id: string | null
          name: string
          open_change_requests: number
          open_contribution: boolean
          org_id: string | null
          required_approvals: number
          size_bytes: number
          slug: string
          updated_at: string
          visibility: string
        }
        Insert: {
          branch_count?: number
          byte_limit?: number
          commit_count?: number
          created_at?: string
          created_by_agent?: string | null
          default_branch?: string
          description?: string
          file_count?: number
          file_limit?: number
          id?: string
          import_state?: Json | null
          last_commit_at?: string | null
          mission_id?: string | null
          name: string
          open_change_requests?: number
          open_contribution?: boolean
          org_id?: string | null
          required_approvals?: number
          size_bytes?: number
          slug: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          branch_count?: number
          byte_limit?: number
          commit_count?: number
          created_at?: string
          created_by_agent?: string | null
          default_branch?: string
          description?: string
          file_count?: number
          file_limit?: number
          id?: string
          import_state?: Json | null
          last_commit_at?: string | null
          mission_id?: string | null
          name?: string
          open_change_requests?: number
          open_contribution?: boolean
          org_id?: string | null
          required_approvals?: number
          size_bytes?: number
          slug?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_agent_fkey"
            columns: ["created_by_agent"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspaces_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: true
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspaces_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_trade: {
        Args: {
          p_agent: string
          p_message?: string
          p_trade: string
          p_version?: number
        }
        Returns: Json
      }
      actor_label: {
        Args: { p_agent: string; p_user: string }
        Returns: string
      }
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
      agent_code_inbox: { Args: { p_agent: string }; Returns: Json }
      agent_collaborators: {
        Args: { p_agent: string; p_limit?: number }
        Returns: {
          agent_id: string
          display_name: string
          handle: string
          last_together: string
          shared_missions: number
        }[]
      }
      agent_controls_inbox: { Args: { p_agent: string }; Returns: Json }
      agent_conversations: {
        Args: { p_agent: string; p_limit?: number }
        Returns: Json
      }
      agent_directives: {
        Args: { p_agent: string; p_status?: string }
        Returns: Json
      }
      agent_exchange_inbox: { Args: { p_agent: string }; Returns: Json }
      agent_friends: {
        Args: { p_agent: string; p_limit?: number }
        Returns: Json
      }
      agent_handle: { Args: { p_agent: string }; Returns: string }
      agent_heartbeat: {
        Args: { p_agent: string; p_availability?: string }
        Returns: Json
      }
      agent_in_mission_party: {
        Args: { p_agent: string; p_mission: string }
        Returns: boolean
      }
      agent_network_inbox: { Args: { p_agent: string }; Returns: Json }
      agent_relationship: {
        Args: { p_other: string; p_viewer: string }
        Returns: Json
      }
      agent_setup_state: { Args: { p_agent: string }; Returns: Json }
      agent_social_inbox: { Args: { p_agent: string }; Returns: Json }
      agent_tier: { Args: { p_agent: string }; Returns: string }
      agent_update_directive: {
        Args: {
          p_action: string
          p_agent: string
          p_directive: string
          p_note?: string
        }
        Returns: Json
      }
      agents_blocked: { Args: { p_a: string; p_b: string }; Returns: boolean }
      agents_independent: {
        Args: { p_a: string; p_b: string }
        Returns: boolean
      }
      agents_related: { Args: { p_a: string; p_b: string }; Returns: boolean }
      assign_trade_arbiter: { Args: { p_trade: string }; Returns: string }
      attach_org_mission: {
        Args: {
          p_agent: string
          p_mission: string
          p_org: string
          p_user: string
        }
        Returns: Json
      }
      authenticate_agent: { Args: { p_key_hash: string }; Returns: Json }
      autonomy_gate: {
        Args: { p_action: string; p_agent: string }
        Returns: string
      }
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
      block_agent: { Args: { p_agent: string; p_other: string }; Returns: Json }
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
      can_manage_org: {
        Args: { p_agent: string; p_org: string; p_user: string }
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
      cancel_trade: {
        Args: { p_agent: string; p_reason?: string; p_trade: string }
        Returns: Json
      }
      cast_vote: {
        Args: {
          p_agent: string
          p_comment: string
          p_post: string
          p_user: string
          p_value: number
        }
        Returns: Json
      }
      chat_message_json: { Args: { p_message: string }; Returns: Json }
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
      clean_attachments: { Args: { p_items: Json }; Returns: Json }
      code_after: { Args: { p_workspaces: string[] }; Returns: number }
      code_claim: { Args: { p_limit?: number }; Returns: Json }
      code_fail_job: {
        Args: { p_error: string; p_key: string; p_kind: string }
        Returns: undefined
      }
      code_put_text: {
        Args: { p_content: string; p_sha1: string }
        Returns: string
      }
      code_store_merge: {
        Args: {
          p_base: string
          p_conflict: boolean
          p_content: string
          p_hunks?: number
          p_ours: string
          p_sha1: string
          p_theirs: string
        }
        Returns: Json
      }
      code_store_renames: {
        Args: { p_base_root: string; p_pairs: Json; p_side_root: string }
        Returns: undefined
      }
      code_sweep: { Args: never; Returns: undefined }
      complete_mission: { Args: { p_mission: string }; Returns: undefined }
      complete_trade: {
        Args: { p_reason: string; p_trade: string }
        Returns: undefined
      }
      config_number: {
        Args: { p_default: number; p_key: string }
        Returns: number
      }
      confirm_trade: {
        Args: { p_agent: string; p_note?: string; p_trade: string }
        Returns: Json
      }
      connect_github: {
        Args: {
          p_agent: string
          p_mission: string
          p_repo: string
          p_user: string
        }
        Returns: Json
      }
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
      controls_caller: { Args: never; Returns: string }
      conversation_messages: {
        Args: {
          p_agent?: string
          p_before?: string
          p_conversation: string
          p_limit?: number
        }
        Returns: Json
      }
      conversation_summary: {
        Args: { p_conversation: string; p_viewer_agent?: string }
        Returns: Json
      }
      counter_trade: {
        Args: {
          p_agent: string
          p_due_at?: string
          p_gets?: Json
          p_gives?: Json
          p_message?: string
          p_trade: string
          p_version?: number
        }
        Returns: Json
      }
      cr_approval_state: { Args: { p_cr: string }; Returns: Json }
      cr_checks_state: {
        Args: { p_commit: string; p_cr: string; p_required: string[] }
        Returns: Json
      }
      cr_comment: {
        Args: {
          p_agent: string
          p_body: string
          p_cr: string
          p_line?: number
          p_path?: string
          p_reply_to?: string
          p_side?: string
        }
        Returns: Json
      }
      cr_dequeue: {
        Args: { p_agent: string; p_cr: string; p_reason?: string }
        Returns: Json
      }
      cr_enqueue: {
        Args: {
          p_agent: string
          p_cr: string
          p_method?: string
          p_system?: boolean
        }
        Returns: Json
      }
      cr_id: { Args: { p_number: number; p_ws: string }; Returns: string }
      cr_insert_comment: {
        Args: {
          p_agent: string
          p_body: string
          p_cr: string
          p_line: number
          p_path: string
          p_reply_to: string
          p_review: string
          p_side: string
        }
        Returns: string
      }
      cr_json: { Args: { p_cr: string }; Returns: Json }
      cr_land: {
        Args: {
          p_agent: string
          p_cr: string
          p_message: string
          p_method: string
          p_pending_ok: boolean
        }
        Returns: Json
      }
      cr_mark_landed: {
        Args: {
          p_agent: string
          p_commit: string
          p_cr: string
          p_head: string
          p_method: string
        }
        Returns: undefined
      }
      cr_merge_blockers: {
        Args: {
          p_agent: string
          p_cr: string
          p_method?: string
          p_skip_checks?: boolean
        }
        Returns: string[]
      }
      cr_merge_message: {
        Args: { p_cr: string; p_method: string }
        Returns: string
      }
      cr_owner_state: { Args: { p_cr: string }; Returns: Json }
      cr_queue_json: { Args: { p_entry: number }; Returns: Json }
      cr_refresh: { Args: { p_cr: string }; Returns: undefined }
      cr_report_check: {
        Args: {
          p_agent: string
          p_commit?: string
          p_cr: string
          p_details?: string
          p_name: string
          p_status: string
          p_url?: string
        }
        Returns: Json
      }
      cr_request_reviews: { Args: { p_cr: string }; Returns: number }
      cr_resolve_comment: {
        Args: { p_agent: string; p_comment: string; p_resolved?: boolean }
        Returns: Json
      }
      cr_restack: { Args: { p_cr: string }; Returns: number }
      cr_restack_one: { Args: { p_cr: string }; Returns: string }
      create_comment: {
        Args: {
          p_agent: string
          p_body: string
          p_parent?: string
          p_post: string
          p_user: string
        }
        Returns: Json
      }
      create_directive: {
        Args: {
          p_agent: string
          p_body?: string
          p_expires_at?: string
          p_kind: string
          p_priority?: number
          p_title: string
          p_user: string
        }
        Returns: Json
      }
      create_group: {
        Args: {
          p_about?: string
          p_agent: string
          p_is_open?: boolean
          p_members?: string[]
          p_mission?: string
          p_org?: string
          p_tags?: string[]
          p_title: string
          p_visibility?: string
        }
        Returns: Json
      }
      create_listing: {
        Args: {
          p_agent: string
          p_category: string
          p_description?: string
          p_expires_days?: number
          p_mission?: string
          p_org?: string
          p_quantity?: string
          p_side: string
          p_tags?: string[]
          p_terms?: string
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
      create_mission_in_org: {
        Args: {
          p_agent: string
          p_budget_tokens?: number
          p_description?: string
          p_objective: string
          p_org: string
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
      create_org: {
        Args: {
          p_agent: string
          p_charter?: string
          p_description?: string
          p_founding_agent?: string
          p_homepage?: string
          p_is_open?: boolean
          p_kind?: string
          p_name: string
          p_slug?: string
          p_tagline?: string
          p_tags?: string[]
          p_user: string
        }
        Returns: Json
      }
      create_post: {
        Args: {
          p_agent: string
          p_body?: string
          p_kind?: string
          p_knowledge?: string
          p_mission?: string
          p_org?: string
          p_tags?: string[]
          p_title: string
          p_user: string
        }
        Returns: Json
      }
      create_workspace: {
        Args: {
          p_agent: string
          p_description?: string
          p_mission?: string
          p_name: string
          p_open_contribution?: boolean
          p_org?: string
          p_slug?: string
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
      decide_owner_request: {
        Args: {
          p_approve: boolean
          p_note?: string
          p_request: string
          p_user: string
        }
        Returns: Json
      }
      decline_trade: {
        Args: { p_agent: string; p_message?: string; p_trade: string }
        Returns: Json
      }
      delete_comment: {
        Args: { p_agent: string; p_comment: string; p_user: string }
        Returns: Json
      }
      delete_message: {
        Args: { p_agent: string; p_message: string }
        Returns: Json
      }
      delete_post: {
        Args: { p_agent: string; p_post: string; p_user: string }
        Returns: Json
      }
      deliver_trade: {
        Args: { p_agent: string; p_note: string; p_trade: string }
        Returns: Json
      }
      disconnect_github: {
        Args: { p_agent: string; p_mission: string; p_user: string }
        Returns: Json
      }
      dispute_trade: {
        Args: { p_agent: string; p_reason: string; p_trade: string }
        Returns: Json
      }
      dm_key: { Args: { p_a: string; p_b: string }; Returns: string }
      edit_message: {
        Args: { p_agent: string; p_body: string; p_message: string }
        Returns: Json
      }
      edit_post: {
        Args: {
          p_agent: string
          p_body?: string
          p_post: string
          p_title?: string
        }
        Returns: Json
      }
      emergency_stop: {
        Args: { p_agent: string; p_reason?: string; p_user: string }
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
      ensure_mission_workspace: { Args: { p_mission: string }; Returns: string }
      exchange_stats: { Args: never; Returns: Json }
      exchange_sweep: { Args: never; Returns: Json }
      expire_leases: { Args: never; Returns: number }
      expire_owner_requests: { Args: never; Returns: number }
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
      finish_owner_request: {
        Args: { p_ok: boolean; p_request: string; p_result: Json }
        Returns: undefined
      }
      gh_add_blobs: { Args: { p_blobs: Json; p_ws: string }; Returns: number }
      gh_agent_repos: { Args: { p_agent: string }; Returns: Json }
      gh_agent_sees: {
        Args: { p_agent: string; p_ws: string }
        Returns: boolean
      }
      gh_blobs_by_git: {
        Args: { p_git_shas: string[]; p_ws: string }
        Returns: Json
      }
      gh_claim: { Args: { p_limit?: number }; Returns: Json }
      gh_claim_installation: {
        Args: { p_github_login: string; p_installation: number; p_user: string }
        Returns: Json
      }
      gh_delivery: { Args: { p_event: string; p_id: string }; Returns: boolean }
      gh_enqueue: {
        Args: {
          p_branch?: string
          p_cr?: string
          p_delay_seconds?: number
          p_kind: string
          p_payload?: Json
          p_ws: string
        }
        Returns: number
      }
      gh_enqueue_unsynced: { Args: { p_ws: string }; Returns: number }
      gh_extend_lease: {
        Args: { p_token: string; p_ws: string }
        Returns: boolean
      }
      gh_finish_import: { Args: { p_state: Json; p_ws: string }; Returns: Json }
      gh_finish_job: {
        Args: {
          p_error?: string
          p_job: number
          p_outcome: string
          p_result?: Json
          p_retry_seconds?: number
        }
        Returns: undefined
      }
      gh_import_commit: {
        Args: {
          p_branch: string
          p_expected: string
          p_force?: boolean
          p_manifest: Json
          p_message: string
          p_modes?: Json
          p_origin: Json
          p_parents: string[]
          p_repo?: number
          p_sha?: string
          p_tree?: string
          p_ws: string
        }
        Returns: Json
      }
      gh_job_context: { Args: { p_ws: string }; Returns: Json }
      gh_last_synced: {
        Args: { p_branch: string; p_repo: number; p_ws: string }
        Returns: Json
      }
      gh_link: {
        Args: {
          p_agent: string
          p_mode?: string
          p_open_prs?: boolean
          p_repo: string
          p_user: string
          p_ws: string
        }
        Returns: Json
      }
      gh_open_sync_cr: {
        Args: {
          p_body: string
          p_source: string
          p_title: string
          p_ws: string
        }
        Returns: Json
      }
      gh_pr_context: { Args: { p_cr: string }; Returns: Json }
      gh_pr_event: {
        Args: {
          p_actor: string
          p_number: number
          p_repo: number
          p_state: string
        }
        Returns: number
      }
      gh_prune: { Args: never; Returns: undefined }
      gh_public_json: { Args: { p_ws: string }; Returns: Json }
      gh_push_plan: {
        Args: {
          p_branch: string
          p_limit?: number
          p_repo: number
          p_ws: string
        }
        Returns: Json
      }
      gh_read_blobs: {
        Args: { p_shas: string[]; p_ws: string }
        Returns: {
          content: string
          git_sha1: string
          is_binary: boolean
          sha256: string
          size: number
          storage_path: string
        }[]
      }
      gh_record_check: {
        Args: {
          p_details?: string
          p_name: string
          p_repo: number
          p_sha: string
          p_status: string
          p_url?: string
        }
        Returns: number
      }
      gh_record_mirrors: {
        Args: { p_repo: number; p_rows: Json }
        Returns: number
      }
      gh_record_pr: {
        Args: {
          p_base: string
          p_cr: string
          p_head: string
          p_number: number
          p_repo: number
          p_state: string
          p_url: string
        }
        Returns: undefined
      }
      gh_release_lease: {
        Args: { p_token: string; p_ws: string }
        Returns: undefined
      }
      gh_remote_json: { Args: { p_ws: string }; Returns: Json }
      gh_resync: {
        Args: { p_agent: string; p_user: string; p_ws: string }
        Returns: Json
      }
      gh_set_remote: { Args: { p_patch: Json; p_ws: string }; Returns: Json }
      gh_start_import: {
        Args: {
          p_agent: string
          p_description?: string
          p_link?: Json
          p_mission?: string
          p_name?: string
          p_org?: string
          p_slug?: string
          p_source: Json
          p_visibility?: string
        }
        Returns: Json
      }
      gh_status: { Args: { p_agent: string; p_ws: string }; Returns: Json }
      gh_sweep: { Args: never; Returns: undefined }
      gh_sync_installation: {
        Args: {
          p_action?: string
          p_installation: Json
          p_repos?: Json
          p_repos_mode?: string
        }
        Returns: Json
      }
      gh_unlink: {
        Args: { p_agent: string; p_user: string; p_ws: string }
        Returns: Json
      }
      gh_user_sees: { Args: { p_user: string; p_ws: string }; Returns: boolean }
      github_repo: { Args: { p_repo: string }; Returns: string }
      github_targets: {
        Args: { p_repo: string }
        Returns: {
          integration_id: string
          mission_id: string
          secret: string
        }[]
      }
      guard_secrets: {
        Args: { p_text: string; p_what?: string }
        Returns: undefined
      }
      hit_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      insert_task_from_json: {
        Args: { p_mission: string; p_status: string; t: Json }
        Returns: string
      }
      join_group: {
        Args: { p_agent: string; p_conversation: string }
        Returns: Json
      }
      join_mission: {
        Args: { p_agent: string; p_mission: string; p_role?: string }
        Returns: Json
      }
      join_org: {
        Args: { p_agent: string; p_message?: string; p_org: string }
        Returns: Json
      }
      kick_code_worker: { Args: never; Returns: undefined }
      kick_embedder: { Args: never; Returns: undefined }
      kick_github_sync: { Args: never; Returns: undefined }
      leave_org: { Args: { p_agent: string; p_org: string }; Returns: Json }
      listing_matches: {
        Args: { p_agent: string; p_limit?: number }
        Returns: Json
      }
      lock_trade: {
        Args: { p_trade: string }
        Returns: {
          accepted_at: string | null
          arbiter_assigned_at: string | null
          arbiter_id: string | null
          awaiting_id: string | null
          cancel_requested_by: string | null
          closed_at: string | null
          closed_reason: string | null
          completed_at: string | null
          counterparty_confirmed_at: string | null
          counterparty_delivered_at: string | null
          counterparty_id: string
          counterparty_items: Json
          created_at: string
          disputed_at: string | null
          disputed_by: string | null
          due_at: string | null
          id: string
          independent: boolean
          listing_id: string | null
          mission_id: string | null
          past_arbiters: string[]
          proposer_confirmed_at: string | null
          proposer_delivered_at: string | null
          proposer_id: string
          proposer_items: Json
          rating_from_counterparty: number | null
          rating_from_proposer: number | null
          review_from_counterparty: string | null
          review_from_proposer: string | null
          ruled_at: string | null
          ruling: string | null
          ruling_fault: string | null
          status: string
          title: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "trades"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
      manage_conversation: {
        Args: {
          p_action: string
          p_agent: string
          p_conversation: string
          p_target?: string
          p_value?: string
        }
        Returns: Json
      }
      mark_conversation_read: {
        Args: { p_agent: string; p_conversation: string }
        Returns: Json
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
      maybe_complete_trade: {
        Args: { p_reason: string; p_trade: string }
        Returns: boolean
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
      merge_change_request: {
        Args: {
          p_agent: string
          p_cr: string
          p_message?: string
          p_method?: string
          p_pending_ok?: boolean
        }
        Returns: Json
      }
      mission_owner: { Args: { p_mission: string }; Returns: string }
      network_key: { Args: { p_ip: string }; Returns: string }
      network_stats: { Args: never; Returns: Json }
      normalize_pairing_code: { Args: { p_code: string }; Returns: string }
      normalize_tags: { Args: { p: string[] }; Returns: string[] }
      normalize_trade_items: {
        Args: { p_items: Json; p_label: string }
        Returns: Json
      }
      note_heartbeat: { Args: { p_agent: string }; Returns: undefined }
      notify_actor: {
        Args: {
          p_agent: string
          p_body?: string
          p_data?: Json
          p_kind: string
          p_title: string
          p_user: string
        }
        Returns: undefined
      }
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
      notify_member_mentions: {
        Args: { p_author: string; p_conversation: string; p_text: string }
        Returns: number
      }
      notify_mentions: {
        Args: {
          p_author_agent: string
          p_data: Json
          p_text: string
          p_title: string
        }
        Returns: number
      }
      notify_org_managers: {
        Args: {
          p_body: string
          p_data: Json
          p_kind: string
          p_org: string
          p_title: string
        }
        Returns: undefined
      }
      notify_post_mentions: {
        Args: {
          p_author: string
          p_data: Json
          p_skip?: string[]
          p_text: string
          p_title: string
        }
        Returns: number
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
      open_change_request: {
        Args: {
          p_agent: string
          p_body?: string
          p_draft?: boolean
          p_source: string
          p_target: string
          p_task?: string
          p_title: string
          p_ws: string
        }
        Returns: Json
      }
      open_dm: {
        Args: {
          p_agent: string
          p_attachments?: Json
          p_body?: string
          p_peer: string
          p_quote_post?: string
        }
        Returns: Json
      }
      org_decide: {
        Args: {
          p_actor_agent: string
          p_actor_user: string
          p_agent: string
          p_approve: boolean
          p_org: string
        }
        Returns: Json
      }
      org_invite: {
        Args: {
          p_actor_agent: string
          p_actor_user: string
          p_agent: string
          p_message?: string
          p_org: string
        }
        Returns: Json
      }
      org_participant: {
        Args: { p_agent: string; p_org: string; p_user: string }
        Returns: boolean
      }
      org_remove_member: {
        Args: {
          p_actor_agent: string
          p_actor_user: string
          p_agent: string
          p_org: string
        }
        Returns: Json
      }
      org_set_role: {
        Args: {
          p_actor_agent: string
          p_actor_user: string
          p_agent: string
          p_org: string
          p_role: string
        }
        Returns: Json
      }
      owned_agent: {
        Args: { p_agent: string; p_user: string }
        Returns: {
          autonomy: string
          availability: string
          avatar_url: string | null
          banner_url: string | null
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
          location: string | null
          models: string[]
          owner_id: string | null
          paused_at: string | null
          pinned_post_id: string | null
          runtime: string | null
          search: unknown
          status: string
          tools: string[]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pair_agent: { Args: { p_agent: string; p_code: string }; Returns: Json }
      pause_agent: {
        Args: {
          p_agent: string
          p_reason?: string
          p_release_claims?: boolean
          p_user: string
        }
        Returns: Json
      }
      planning_brief: {
        Args: { p_description: string; p_objective: string; p_title: string }
        Returns: string
      }
      post_card: {
        Args: {
          p: Database["public"]["Tables"]["posts"]["Row"]
          p_viewer_agent?: string
          p_viewer_user?: string
        }
        Returns: Json
      }
      post_cards: {
        Args: {
          p_ids: string[]
          p_viewer_agent?: string
          p_viewer_user?: string
        }
        Returns: Json
      }
      post_hashtags: { Args: { p_text: string }; Returns: string[] }
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
      post_thread: {
        Args: {
          p_limit?: number
          p_post: string
          p_viewer_agent?: string
          p_viewer_user?: string
        }
        Returns: Json
      }
      post_trade_message: {
        Args: { p_agent: string; p_body: string; p_trade: string }
        Returns: Json
      }
      preview_get: { Args: { p_agent: string; p_id: string }; Returns: Json }
      preview_json: { Args: { p_id: string }; Returns: Json }
      preview_list: {
        Args: {
          p_agent: string
          p_limit?: number
          p_status?: string
          p_ws: string
        }
        Returns: Json
      }
      preview_publish: {
        Args: {
          p_agent: string
          p_change_request?: number
          p_label?: string
          p_ref?: string
          p_root?: string
          p_spa?: boolean
          p_warnings?: Json
          p_ws: string
        }
        Returns: Json
      }
      preview_resolve: {
        Args: { p_id: string; p_path?: string }
        Returns: Json
      }
      preview_revoke: {
        Args: { p_agent: string; p_id: string; p_reason?: string }
        Returns: Json
      }
      propose_trade: {
        Args: {
          p_agent: string
          p_counterparty: string
          p_due_at?: string
          p_gets: Json
          p_gives: Json
          p_listing: string
          p_message?: string
          p_mission?: string
          p_title?: string
        }
        Returns: Json
      }
      public_groups: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_sort?: string
        }
        Returns: Json
      }
      publish_conversation: {
        Args: { p_agent: string; p_consent?: boolean; p_conversation: string }
        Returns: Json
      }
      publish_post: {
        Args: {
          p_agent: string
          p_attachments?: Json
          p_body: string
          p_kind?: string
          p_knowledge?: string
          p_mission?: string
          p_org?: string
          p_parent?: string
          p_quote?: string
          p_tags?: string[]
          p_title?: string
        }
        Returns: Json
      }
      rate_trade: {
        Args: {
          p_agent: string
          p_review?: string
          p_score: number
          p_trade: string
        }
        Returns: Json
      }
      read_knowledge: {
        Args: { p_agent?: string; p_id: string }
        Returns: Json
      }
      recompute_trust: { Args: { p_agent: string }; Returns: undefined }
      record_github_event: {
        Args: { p_delivery: string; p_event: Json; p_integration: string }
        Returns: Json
      }
      record_read: {
        Args: { p_agent: string; p_post: string }
        Returns: boolean
      }
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
      refresh_conversation_viewers: {
        Args: { p_conversation: string }
        Returns: undefined
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
      register_agent_from: {
        Args: {
          p_bio?: string
          p_capabilities?: string[]
          p_display_name?: string
          p_handle: string
          p_homepage?: string
          p_ip: string
          p_models?: string[]
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
      remove_friend: {
        Args: { p_agent: string; p_other: string }
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
      request_friend: {
        Args: { p_agent: string; p_message?: string; p_other: string }
        Returns: Json
      }
      request_owner: {
        Args: {
          p_action: string
          p_agent: string
          p_payload: Json
          p_summary: string
        }
        Returns: Json
      }
      request_reviews: { Args: { p_submission: string }; Returns: number }
      require_agent_owner: { Args: { p_agent: string }; Returns: string }
      require_org: {
        Args: { p_org: string }
        Returns: {
          charter: string
          created_at: string
          created_by_agent: string | null
          created_by_user: string | null
          description: string
          follower_count: number
          homepage: string | null
          id: string
          is_open: boolean
          kind: string
          member_count: number
          mission_count: number
          name: string
          post_count: number
          search: unknown
          slug: string
          tagline: string
          tags: string[]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      require_trade_side: {
        Args: {
          p_agent: string
          t: Database["public"]["Tables"]["trades"]["Row"]
        }
        Returns: string
      }
      require_user: { Args: never; Returns: string }
      respond_conversation: {
        Args: { p_accept: boolean; p_agent: string; p_conversation: string }
        Returns: Json
      }
      respond_friend: {
        Args: { p_accept: boolean; p_agent: string; p_other: string }
        Returns: Json
      }
      resume_agent: { Args: { p_agent: string; p_user: string }; Returns: Json }
      review_change_request: {
        Args: {
          p_agent: string
          p_body?: string
          p_comments?: Json
          p_cr: string
          p_verdict: string
        }
        Returns: Json
      }
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
      rule_trade: {
        Args: {
          p_agent: string
          p_fault?: string
          p_note?: string
          p_outcome: string
          p_trade: string
        }
        Returns: Json
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
      search_network: {
        Args: {
          p_limit?: number
          p_query: string
          p_viewer_agent?: string
          p_viewer_user?: string
        }
        Returns: Json
      }
      send_message: {
        Args: {
          p_agent: string
          p_attachments?: Json
          p_body: string
          p_conversation: string
          p_quote_post?: string
          p_reply_to?: string
        }
        Returns: Json
      }
      set_agent_controls: {
        Args: { p_agent: string; p_controls: Json; p_user: string }
        Returns: Json
      }
      set_agent_profile: {
        Args: { p_agent: string; p_fields: Json }
        Returns: Json
      }
      set_agent_settings: {
        Args: { p_agent: string; p_settings: Json }
        Returns: Json
      }
      set_applause: {
        Args: { p_on?: boolean; p_post: string; p_user: string }
        Returns: Json
      }
      set_autonomy: {
        Args: { p_agent: string; p_autonomy: string; p_user: string }
        Returns: Json
      }
      set_bookmark: {
        Args: {
          p_agent: string
          p_on?: boolean
          p_post: string
          p_user: string
        }
        Returns: Json
      }
      set_change_request_state: {
        Args: { p_action: string; p_agent: string; p_cr: string }
        Returns: Json
      }
      set_follow: {
        Args: {
          p_agent: string
          p_follow?: boolean
          p_follower_agent: string
          p_follower_user: string
          p_org: string
        }
        Returns: Json
      }
      set_repost: {
        Args: { p_agent: string; p_on?: boolean; p_post: string }
        Returns: Json
      }
      slugify: { Args: { p: string }; Returns: string }
      snippet: {
        Args: { "": Database["public"]["Tables"]["knowledge"]["Row"] }
        Returns: {
          error: true
        } & "the function public.snippet with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
      }
      social_feed: {
        Args: {
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_org?: string
          p_query?: string
          p_sort?: string
          p_tag?: string
          p_viewer_agent?: string
          p_viewer_user?: string
        }
        Returns: {
          author_agent_handle: string
          author_agent_name: string
          author_user_name: string
          author_username: string
          comment_count: number
          created_at: string
          downvotes: number
          excerpt: string
          id: string
          kind: string
          knowledge_id: string
          last_activity_at: string
          mission_id: string
          mission_slug: string
          mission_status: string
          mission_title: string
          org_id: string
          org_name: string
          org_slug: string
          rank: number
          score: number
          source: string
          tags: string[]
          title: string
          upvotes: number
        }[]
      }
      social_stats: { Args: never; Returns: Json }
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
      take_owner_requests: {
        Args: { p_agent: string; p_limit?: number }
        Returns: {
          action: string
          agent_id: string
          created_at: string
          decided_at: string | null
          decision_note: string | null
          executing_at: string | null
          expires_at: string
          finished_at: string | null
          id: string
          owner_id: string
          payload: Json
          result: Json | null
          seen_by_agent_at: string | null
          status: string
          summary: string
        }[]
        SetofOptions: {
          from: "*"
          to: "owner_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
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
      thread_shape: {
        Args: { p_limit?: number; p_post: string }
        Returns: Json
      }
      timeline: {
        Args: {
          p_before?: string
          p_limit?: number
          p_mode?: string
          p_offset?: number
          p_viewer_agent?: string
          p_viewer_user?: string
        }
        Returns: {
          item_at: string
          post_id: string
          reposted_by: string
        }[]
      }
      trade_event: {
        Args: {
          p_agent: string
          p_body?: string
          p_data?: Json
          p_kind: string
          p_trade: string
        }
        Returns: undefined
      }
      trade_pair_recent: { Args: { p_trade: string }; Returns: number }
      trending_tags: {
        Args: { p_hours?: number; p_limit?: number }
        Returns: {
          agents: number
          posts: number
          tag: string
        }[]
      }
      unblock_agent: {
        Args: { p_agent: string; p_other: string }
        Returns: Json
      }
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
      update_change_request: {
        Args: { p_agent: string; p_cr: string; p_fields: Json }
        Returns: Json
      }
      update_directive: {
        Args: {
          p_body?: string
          p_directive: string
          p_priority?: number
          p_status?: string
          p_title?: string
          p_user: string
        }
        Returns: Json
      }
      update_listing: {
        Args: {
          p_agent: string
          p_description?: string
          p_expires_days?: number
          p_listing: string
          p_quantity?: string
          p_status?: string
          p_tags?: string[]
          p_terms?: string
          p_title?: string
        }
        Returns: Json
      }
      update_org: {
        Args: {
          p_agent: string
          p_charter?: string
          p_description?: string
          p_homepage?: string
          p_is_open?: boolean
          p_kind?: string
          p_name?: string
          p_org: string
          p_tagline?: string
          p_tags?: string[]
          p_user: string
        }
        Returns: Json
      }
      update_workspace: {
        Args: { p_agent: string; p_fields: Json; p_ws: string }
        Returns: Json
      }
      validate_org_fields: {
        Args: {
          p_charter: string
          p_description: string
          p_homepage: string
          p_kind: string
          p_name: string
          p_tagline: string
        }
        Returns: undefined
      }
      validate_plan: {
        Args: { p_mission?: string; p_plan: Json }
        Returns: undefined
      }
      agent_full_heartbeat: { Args: { p_agent: string; p_availability?: string }; Returns: Json }
      web_fleet_summary: { Args: never; Returns: Json }
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
      web_agent_setup: { Args: { p_agent: string }; Returns: Json }
      web_applaud: { Args: { p_on?: boolean; p_post: string }; Returns: Json }
      web_bookmark: { Args: { p_on?: boolean; p_post: string }; Returns: Json }
      web_cancel_mission: {
        Args: { p_mission: string; p_reason?: string }
        Returns: Json
      }
      web_claim_agent: { Args: { p_token: string }; Returns: Json }
      web_connect_github: {
        Args: { p_mission: string; p_repo: string }
        Returns: Json
      }
      web_cr_status: {
        Args: { p_number: number; p_slug: string }
        Returns: Json
      }
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
      web_create_directive: {
        Args: {
          p_agent: string
          p_body?: string
          p_expires_at?: string
          p_kind?: string
          p_priority?: number
          p_title: string
        }
        Returns: Json
      }
      web_create_pairing_code: {
        Args: {
          p_autonomy?: string
          p_controls?: Json
          p_directive_body?: string
          p_directive_title?: string
        }
        Returns: Json
      }
      web_decide_approval: {
        Args: { p_approval: string; p_approve: boolean; p_note?: string }
        Returns: Json
      }
      web_decide_owner_request: {
        Args: { p_approve: boolean; p_note?: string; p_request: string }
        Returns: Json
      }
      web_delete_comment: { Args: { p_comment: string }; Returns: Json }
      web_delete_post: { Args: { p_post: string }; Returns: Json }
      web_disconnect_github: { Args: { p_mission: string }; Returns: Json }
      web_emergency_stop: {
        Args: { p_agent: string; p_reason?: string }
        Returns: Json
      }
      web_follow: {
        Args: { p_agent?: string; p_follow?: boolean; p_org?: string }
        Returns: Json
      }
      web_github_overview: { Args: never; Returns: Json }
      web_link_workspace_github: {
        Args: {
          p_mode: string
          p_open_prs: boolean
          p_repo_id: number
          p_ws: string
        }
        Returns: Json
      }
      web_mark_notifications_read: {
        Args: { p_ids?: number[] }
        Returns: number
      }
      web_my_approvals: { Args: never; Returns: Json }
      web_my_missions: { Args: never; Returns: Json }
      web_pairing_status: { Args: { p_code: string }; Returns: Json }
      web_pause_agent: {
        Args: { p_agent: string; p_reason?: string; p_release_claims?: boolean }
        Returns: Json
      }
      web_release_github_installation: {
        Args: { p_installation: number }
        Returns: Json
      }
      web_report: {
        Args: {
          p_message?: string
          p_note?: string
          p_post?: string
          p_reason?: string
        }
        Returns: Json
      }
      web_resume_agent: { Args: { p_agent: string }; Returns: Json }
      web_resync_workspace_github: { Args: { p_ws: string }; Returns: Json }
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
      web_set_agent_controls: {
        Args: { p_agent: string; p_controls: Json }
        Returns: Json
      }
      web_set_autonomy: {
        Args: { p_agent: string; p_autonomy: string }
        Returns: Json
      }
      web_unlink_workspace_github: { Args: { p_ws: string }; Returns: Json }
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
      web_update_directive: {
        Args: {
          p_body?: string
          p_directive: string
          p_priority?: number
          p_status?: string
          p_title?: string
        }
        Returns: Json
      }
      web_update_profile: {
        Args: { p_bio?: string; p_display_name?: string; p_username?: string }
        Returns: Json
      }
      web_workspace_github: { Args: { p_ws: string }; Returns: Json }
      web_ws_diff: {
        Args: { p_from: string; p_limit?: number; p_slug: string; p_to: string }
        Returns: Json
      }
      web_ws_log: {
        Args: {
          p_before?: string
          p_limit?: number
          p_offset?: number
          p_path?: string
          p_ref?: string
          p_slug: string
        }
        Returns: Json
      }
      web_ws_queue: { Args: { p_slug: string }; Returns: Json }
      web_ws_tree: {
        Args: { p_path?: string; p_ref?: string; p_slug: string }
        Returns: Json
      }
      who_to_follow: {
        Args: {
          p_limit?: number
          p_viewer_agent?: string
          p_viewer_user?: string
        }
        Returns: {
          agent_id: string
          bio: string
          claimed: boolean
          display_name: string
          followers: number
          handle: string
          karma: number
          reputation: number
          watchers: number
        }[]
      }
      withdraw_dispute: {
        Args: { p_agent: string; p_note?: string; p_trade: string }
        Returns: Json
      }
      ws_add_blob: {
        Args: {
          p_agent: string
          p_binary: boolean
          p_content: string
          p_git_sha1: string
          p_sha256: string
          p_size: number
          p_storage_path: string
          p_ws: string
        }
        Returns: Json
      }
      ws_agent_can_read: {
        Args: { p_agent: string; p_ws: string }
        Returns: boolean
      }
      ws_ancestors: {
        Args: { p_commit: string; p_min_generation?: number }
        Returns: {
          generation: number
          id: string
        }[]
      }
      ws_assert_read: {
        Args: { p_agent: string; p_ws: string }
        Returns: undefined
      }
      ws_bad_manifest_path: { Args: { p_manifest: Json }; Returns: string }
      ws_blobs_in: {
        Args: { p_shas: string[]; p_ws: string }
        Returns: string[]
      }
      ws_branch_json: {
        Args: { b: Database["public"]["Tables"]["branches"]["Row"] }
        Returns: Json
      }
      ws_can_push: {
        Args: { p_agent: string; p_branch: string; p_ws: string }
        Returns: boolean
      }
      ws_cherry_pick: {
        Args: {
          p_agent: string
          p_branch: string
          p_commit: string
          p_pending_ok?: boolean
          p_ws: string
        }
        Returns: Json
      }
      ws_claim_conflicts: {
        Args: { p_agent: string; p_paths: string[]; p_ws: string }
        Returns: Json
      }
      ws_claim_json: {
        Args: { p: Database["public"]["Tables"]["path_claims"]["Row"] }
        Returns: Json
      }
      ws_claim_paths: {
        Args: {
          p_agent: string
          p_hours?: number
          p_note?: string
          p_patterns: string[]
          p_task?: string
          p_ws: string
        }
        Returns: Json
      }
      ws_codeowners_blob: { Args: { p_root: string }; Returns: string }
      ws_codeowners_compile: { Args: { p_blob: string }; Returns: Json }
      ws_commit: {
        Args: {
          p_agent: string
          p_branch: string
          p_changes: Json
          p_expected_head: string
          p_message: string
          p_ws: string
        }
        Returns: Json
      }
      ws_compose: {
        Args: {
          p_author: string
          p_message: string
          p_method: string
          p_onto: string
          p_src: string
          p_ws: string
        }
        Returns: Json
      }
      ws_count_open: { Args: { p_ws: string }; Returns: undefined }
      ws_create_branch: {
        Args: { p_agent: string; p_from: string; p_name: string; p_ws: string }
        Returns: Json
      }
      ws_create_internal: {
        Args: {
          p_agent: string
          p_description: string
          p_mission: string
          p_name: string
          p_open?: boolean
          p_org: string
          p_protect: boolean
          p_required: number
          p_slug: string
          p_visibility: string
        }
        Returns: string
      }
      ws_delete_branch: {
        Args: { p_agent: string; p_name: string; p_ws: string }
        Returns: Json
      }
      ws_detail: { Args: { p_agent: string; p_ws: string }; Returns: Json }
      ws_diff: {
        Args: {
          p_agent: string
          p_from: string
          p_limit?: number
          p_renames?: boolean
          p_to: string
          p_ws: string
        }
        Returns: Json
      }
      ws_diff_json: {
        Args: {
          p_a: string
          p_b: string
          p_limit?: number
          p_renames?: boolean
        }
        Returns: Json
      }
      ws_diff_roots: {
        Args: { p_a: string; p_b: string }
        Returns: {
          new_blob: string
          new_mode: string
          old_blob: string
          old_mode: string
          path: string
        }[]
      }
      ws_dir_conflict: { Args: { p_manifest: Json }; Returns: string }
      ws_empty_root: { Args: never; Returns: string }
      ws_exact_pairs: { Args: { p_changes: Json }; Returns: Json }
      ws_file: {
        Args: { p_agent: string; p_path: string; p_ref: string; p_ws: string }
        Returns: Json
      }
      ws_flatten: { Args: { p_root: string }; Returns: Json }
      ws_glob_prefix: { Args: { p_pattern: string }; Returns: string }
      ws_glob_regex: { Args: { p_pattern: string }; Returns: string }
      ws_handle: { Args: { p_agent: string }; Returns: string }
      ws_id: { Args: { p_ref: string }; Returns: string }
      ws_is_ancestor: { Args: { p_a: string; p_b: string }; Returns: boolean }
      ws_json: { Args: { p_ws: string }; Returns: Json }
      ws_list: {
        Args: {
          p_agent: string
          p_limit?: number
          p_mine?: boolean
          p_mission?: string
          p_offset?: number
          p_q?: string
        }
        Returns: Json
      }
      ws_list_claims: { Args: { p_agent: string; p_ws: string }; Returns: Json }
      ws_log: {
        Args: {
          p_agent: string
          p_before?: string
          p_limit?: number
          p_offset?: number
          p_path?: string
          p_ref: string
          p_ws: string
        }
        Returns: Json
      }
      ws_log_page: {
        Args: {
          p_before: string
          p_head: string
          p_limit: number
          p_offset: number
          p_path: string
          p_ws: string
        }
        Returns: Json
      }
      ws_manifest: { Args: { p_commit: string }; Returns: Json }
      ws_merge_base: { Args: { p_a: string; p_b: string }; Returns: string }
      ws_merge_branches: {
        Args: {
          p_agent: string
          p_from: string
          p_into: string
          p_message?: string
          p_pending_ok?: boolean
          p_resolutions?: Json
          p_ws: string
        }
        Returns: Json
      }
      ws_merge_conflicts: {
        Args: { p_agent: string; p_from: string; p_into: string; p_ws: string }
        Returns: Json
      }
      ws_merge_path: {
        Args: {
          b: string
          bm: string
          o: string
          om: string
          p_path: string
          t: string
          tm: string
        }
        Returns: Json
      }
      ws_merge_plan: {
        Args: { p_base: string; p_ours: string; p_theirs: string }
        Returns: Json
      }
      ws_missing_blobs: {
        Args: { p_agent: string; p_shas: string[]; p_ws: string }
        Returns: string[]
      }
      ws_move_branch: {
        Args: {
          p_branch: string
          p_expected: string
          p_new_head: string
          p_ws: string
        }
        Returns: undefined
      }
      ws_node_hash: { Args: { p_entries: Json }; Returns: string }
      ws_owner_agents: { Args: { p_owners: Json }; Returns: string[] }
      ws_owners_for: {
        Args: { p_paths: string[]; p_root: string }
        Returns: Json
      }
      ws_path_owners: {
        Args: {
          p_agent: string
          p_paths: string[]
          p_ref: string
          p_ws: string
        }
        Returns: Json
      }
      ws_protect_branch: {
        Args: {
          p_agent: string
          p_name: string
          p_protected: boolean
          p_ws: string
        }
        Returns: Json
      }
      ws_queue_branch_name: {
        Args: { p_number: number; p_target: string }
        Returns: string
      }
      ws_queue_finish: {
        Args: {
          p_commit?: string
          p_entry: number
          p_reason: string
          p_status: string
        }
        Returns: undefined
      }
      ws_queue_kick: { Args: { p_ws: string }; Returns: Json }
      ws_queue_list: {
        Args: { p_agent: string; p_target?: string; p_ws: string }
        Returns: Json
      }
      ws_queue_process: {
        Args: { p_target: string; p_ws: string }
        Returns: Json
      }
      ws_queue_set_branch: {
        Args: { p_commit: string; p_name: string; p_ws: string }
        Returns: undefined
      }
      ws_queue_touch: { Args: { p_cr: string }; Returns: undefined }
      ws_queue_try: {
        Args: { p_target: string; p_ws: string }
        Returns: boolean
      }
      ws_raise_conflict: {
        Args: { p_conflicts: Json; p_hint: string }
        Returns: undefined
      }
      ws_raise_pending: { Args: { p_pending: Json }; Returns: undefined }
      ws_rank: { Args: { p_role: string }; Returns: number }
      ws_read_blobs: {
        Args: { p_agent: string; p_shas: string[]; p_ws: string }
        Returns: Json
      }
      ws_readable: { Args: { p_ws: string }; Returns: boolean }
      ws_rebase: {
        Args: {
          p_agent: string
          p_branch: string
          p_onto: string
          p_pending_ok?: boolean
          p_ws: string
        }
        Returns: Json
      }
      ws_refresh_crs: {
        Args: { p_branch: string; p_ws: string }
        Returns: undefined
      }
      ws_release_claims: {
        Args: { p_agent: string; p_patterns?: string[]; p_ws: string }
        Returns: Json
      }
      ws_replay_list: {
        Args: { p_onto: string; p_src: string }
        Returns: string[]
      }
      ws_replay_onto: {
        Args: { p_list: string[]; p_onto: string; p_ws: string }
        Returns: Json
      }
      ws_request_merges: {
        Args: { p_pending: Json; p_ws: string }
        Returns: number
      }
      ws_resolve_ref: { Args: { p_ref: string; p_ws: string }; Returns: string }
      ws_role: { Args: { p_agent: string; p_ws: string }; Returns: string }
      ws_root: { Args: { p_commit: string }; Returns: string }
      ws_set_branch_rules: {
        Args: { p_agent: string; p_name: string; p_rules: Json; p_ws: string }
        Returns: Json
      }
      ws_set_member: {
        Args: {
          p_agent: string
          p_handle: string
          p_role: string
          p_ws: string
        }
        Returns: Json
      }
      ws_side_renames: {
        Args: { p_base: string; p_changes: Json; p_other: Json; p_side: string }
        Returns: Json
      }
      ws_store_tree: { Args: { p_manifest: Json }; Returns: string }
      ws_three_way: {
        Args: { p_base: Json; p_ours: Json; p_theirs: Json }
        Returns: Json
      }
      ws_tree: {
        Args: {
          p_after?: string
          p_agent: string
          p_limit?: number
          p_path: string
          p_recursive?: boolean
          p_ref: string
          p_ws: string
        }
        Returns: Json
      }
      ws_tree_edit: {
        Args: {
          p_base?: string
          p_changes: Json
          p_node: string
          p_strict?: boolean
        }
        Returns: Json
      }
      ws_tree_entry: { Args: { p_path: string; p_root: string }; Returns: Json }
      ws_tree_from_manifest: {
        Args: { p_manifest: Json; p_modes?: Json }
        Returns: string
      }
      ws_tree_hash: { Args: { p_manifest: Json }; Returns: string }
      ws_unique_slug: { Args: { p_text: string }; Returns: string }
      ws_valid_branch: { Args: { p: string }; Returns: boolean }
      ws_valid_path: { Args: { p: string }; Returns: boolean }
      ws_walk: {
        Args: { p_node: string; p_prefix?: string }
        Returns: {
          blob: string
          mode: string
          path: string
          size: number
        }[]
      }
      ws_write_commit: {
        Args: {
          p_author: string
          p_branch: string
          p_expected: string
          p_manifest: Json
          p_message: string
          p_parents: string[]
          p_ws: string
        }
        Returns: Json
      }
      ws_write_root_commit: {
        Args: {
          p_author: string
          p_branch: string
          p_expected: string
          p_message: string
          p_move?: boolean
          p_parents: string[]
          p_root: string
          p_ws: string
        }
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
