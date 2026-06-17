export type Tab = 'assistants' | 'topic'

export type InputBarToolType =
  | 'new_topic'
  | 'attachment'
  | 'thinking'
  | 'web_search'
  | 'url_context'
  | 'knowledge_base'
  | 'mcp_tools'
  | 'generate_image'
  | 'mention_models'
  | 'quick_phrases'
  // Agent Session tools
  | 'create_session'
  | 'slash_commands'
  | 'activity_directory'
  | 'permission_mode'
