CREATE TABLE crm_project_task_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm_project_task_dependencies_distinct_tasks
        CHECK (task_id <> depends_on_task_id),
    CONSTRAINT crm_project_task_dependencies_unique_edge
        UNIQUE (project_id, task_id, depends_on_task_id)
);

CREATE INDEX idx_crm_project_task_dependencies_task
    ON crm_project_task_dependencies(project_id, task_id);

CREATE INDEX idx_crm_project_task_dependencies_prerequisite
    ON crm_project_task_dependencies(project_id, depends_on_task_id);

CREATE OR REPLACE FUNCTION validate_crm_project_task_dependency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    linked_task_count INTEGER;
    creates_cycle BOOLEAN;
BEGIN
    SELECT COUNT(*)
      INTO linked_task_count
      FROM tasks
     WHERE id IN (NEW.task_id, NEW.depends_on_task_id)
       AND project_id = NEW.project_id
       AND deleted_at IS NULL;

    IF linked_task_count <> 2 THEN
        RAISE EXCEPTION 'Both workflow tasks must belong to the selected project';
    END IF;

    WITH RECURSIVE prerequisites(task_id) AS (
        SELECT dependency.depends_on_task_id
          FROM crm_project_task_dependencies dependency
         WHERE dependency.project_id = NEW.project_id
           AND dependency.task_id = NEW.depends_on_task_id
           AND dependency.id <> COALESCE(NEW.id, gen_random_uuid())
        UNION
        SELECT dependency.depends_on_task_id
          FROM crm_project_task_dependencies dependency
          JOIN prerequisites parent ON parent.task_id = dependency.task_id
         WHERE dependency.project_id = NEW.project_id
           AND dependency.id <> COALESCE(NEW.id, gen_random_uuid())
    )
    SELECT EXISTS(
        SELECT 1 FROM prerequisites WHERE task_id = NEW.task_id
    ) INTO creates_cycle;

    IF creates_cycle THEN
        RAISE EXCEPTION 'Workflow dependency would create a cycle';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER crm_project_task_dependencies_validate
BEFORE INSERT OR UPDATE ON crm_project_task_dependencies
FOR EACH ROW
EXECUTE FUNCTION validate_crm_project_task_dependency();

CREATE OR REPLACE FUNCTION cleanup_crm_project_task_dependencies()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        DELETE FROM crm_project_task_dependencies
         WHERE task_id = NEW.id OR depends_on_task_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_cleanup_project_workflow_dependencies
AFTER UPDATE OF project_id, deleted_at ON tasks
FOR EACH ROW
EXECUTE FUNCTION cleanup_crm_project_task_dependencies();
