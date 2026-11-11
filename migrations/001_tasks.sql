CREATE TABLE plugin_personal_todo_f8dc7ec3ac.boards (company_id text NOT NULL, user_id text NOT NULL, collector_agent_id text, routine_id text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (company_id,user_id));
CREATE UNIQUE INDEX boards_collector ON plugin_personal_todo_f8dc7ec3ac.boards(company_id,collector_agent_id) WHERE collector_agent_id IS NOT NULL;
CREATE TABLE plugin_personal_todo_f8dc7ec3ac.tasks (company_id text NOT NULL, user_id text NOT NULL, doc_id text NOT NULL, revision integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY (company_id,user_id,doc_id));
CREATE TABLE plugin_personal_todo_f8dc7ec3ac.source_state (company_id text NOT NULL, user_id text NOT NULL, provider text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (company_id,user_id,provider));
