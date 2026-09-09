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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_tokens: {
        Row: {
          agent_id: string
          created_at: string
          token: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          token: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tokens_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_upgrades: {
        Row: {
          agent_id: string
          agent_name: string
          channel: string
          finished_at: string | null
          from_version: string
          id: string
          logs: Json
          progress: number
          report: Json | null
          stage: string
          started_at: string
          status: string
          to_version: string
          trigger: string
        }
        Insert: {
          agent_id: string
          agent_name?: string
          channel?: string
          finished_at?: string | null
          from_version?: string
          id?: string
          logs?: Json
          progress?: number
          report?: Json | null
          stage?: string
          started_at?: string
          status?: string
          to_version?: string
          trigger?: string
        }
        Update: {
          agent_id?: string
          agent_name?: string
          channel?: string
          finished_at?: string | null
          from_version?: string
          id?: string
          logs?: Json
          progress?: number
          report?: Json | null
          stage?: string
          started_at?: string
          status?: string
          to_version?: string
          trigger?: string
        }
        Relationships: []
      }
      agents: {
        Row: {
          capabilities: Json
          concurrency: number
          cpu: number
          created_at: string
          host: string
          id: string
          ip: string
          last_heartbeat: string
          memory: number
          name: string
          os: string
          status: string
          total_runs: number
          version: string
        }
        Insert: {
          capabilities?: Json
          concurrency?: number
          cpu?: number
          created_at?: string
          host?: string
          id: string
          ip?: string
          last_heartbeat?: string
          memory?: number
          name: string
          os?: string
          status?: string
          total_runs?: number
          version?: string
        }
        Update: {
          capabilities?: Json
          concurrency?: number
          cpu?: number
          created_at?: string
          host?: string
          id?: string
          ip?: string
          last_heartbeat?: string
          memory?: number
          name?: string
          os?: string
          status?: string
          total_runs?: number
          version?: string
        }
        Relationships: []
      }
      case_runs: {
        Row: {
          agent_id: string | null
          attempt: number
          case_id: string | null
          case_name: string
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          started_at: string
          status: string
          step_index: number
          step_total: number
          steps: Json
          task_id: string | null
        }
        Insert: {
          agent_id?: string | null
          attempt?: number
          case_id?: string | null
          case_name?: string
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          step_index?: number
          step_total?: number
          steps?: Json
          task_id?: string | null
        }
        Update: {
          agent_id?: string | null
          attempt?: number
          case_id?: string | null
          case_name?: string
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          step_index?: number
          step_total?: number
          steps?: Json
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_runs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "test_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_runs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          auto_dispatch: boolean
          auto_upgrade: boolean
          default_concurrency: number
          default_retry: number
          heartbeat_timeout_sec: number
          id: number
          keep_report_days: number
          min_agent_version: string
          notify_email: string
          notify_on_failure: boolean
          platform_name: string
          trace_mode: string
          update_channel: string
          updated_at: string
          video_on_failure: boolean
        }
        Insert: {
          auto_dispatch?: boolean
          auto_upgrade?: boolean
          default_concurrency?: number
          default_retry?: number
          heartbeat_timeout_sec?: number
          id?: number
          keep_report_days?: number
          min_agent_version?: string
          notify_email?: string
          notify_on_failure?: boolean
          platform_name?: string
          trace_mode?: string
          update_channel?: string
          updated_at?: string
          video_on_failure?: boolean
        }
        Update: {
          auto_dispatch?: boolean
          auto_upgrade?: boolean
          default_concurrency?: number
          default_retry?: number
          heartbeat_timeout_sec?: number
          id?: number
          keep_report_days?: number
          min_agent_version?: string
          notify_email?: string
          notify_on_failure?: boolean
          platform_name?: string
          trace_mode?: string
          update_channel?: string
          updated_at?: string
          video_on_failure?: boolean
        }
        Relationships: []
      }
      run_logs: {
        Row: {
          at: string
          id: number
          level: string
          message: string
          run_id: string | null
        }
        Insert: {
          at?: string
          id?: number
          level?: string
          message?: string
          run_id?: string | null
        }
        Update: {
          at?: string
          id?: number
          level?: string
          message?: string
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "run_logs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "case_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      task_logs: {
        Row: {
          at: string
          id: number
          level: string
          message: string
          task_id: string | null
        }
        Insert: {
          at?: string
          id?: number
          level?: string
          message?: string
          task_id?: string | null
        }
        Update: {
          at?: string
          id?: number
          level?: string
          message?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          agent_id: string | null
          browser: string
          concurrency: number
          created_at: string
          env: string
          finished_at: string | null
          id: string
          name: string
          retry: number
          stage: string
          status: string
          trigger: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          browser?: string
          concurrency?: number
          created_at?: string
          env?: string
          finished_at?: string | null
          id?: string
          name: string
          retry?: number
          stage?: string
          status?: string
          trigger?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          browser?: string
          concurrency?: number
          created_at?: string
          env?: string
          finished_at?: string | null
          id?: string
          name?: string
          retry?: number
          stage?: string
          status?: string
          trigger?: string
          updated_at?: string
        }
        Relationships: []
      }
      test_cases: {
        Row: {
          agent_id: string | null
          author: string
          created_at: string
          id: string
          module: string
          name: string
          priority: string
          script: string
          source: string
          start_url: string
          status: string
          steps: Json
          tags: Json
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          author?: string
          created_at?: string
          id?: string
          module?: string
          name: string
          priority?: string
          script?: string
          source?: string
          start_url?: string
          status?: string
          steps?: Json
          tags?: Json
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          author?: string
          created_at?: string
          id?: string
          module?: string
          name?: string
          priority?: string
          script?: string
          source?: string
          start_url?: string
          status?: string
          steps?: Json
          tags?: Json
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
