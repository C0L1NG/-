"""Compare schema objects, never financial row contents."""

import re
import uuid

from sqlalchemy import text

from .migrations import upgrade_connection

QUERIES = {
    "columns": """SELECT c.relname AS object, a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS required, pg_get_expr(d.adbin,d.adrelid) AS default
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname NOT IN ('alembic_version','_prisma_migrations')
      ORDER BY c.relname,a.attname""",
    "constraints": """SELECT c.relname AS object, k.conname AS name, pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname NOT IN ('alembic_version','_prisma_migrations')
      ORDER BY c.relname,k.conname""",
    "indexes": """SELECT c.relname AS object,i.relname AS name,pg_get_indexdef(i.oid) AS definition,
      x.indisvalid AS valid,x.indisready AS ready
      FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
      JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname NOT IN ('alembic_version','_prisma_migrations')
      ORDER BY c.relname,i.relname""",
    "triggers": """SELECT c.relname AS object,t.tgname AS name,t.tgenabled::text AS enabled,pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND NOT t.tgisinternal ORDER BY c.relname,t.tgname""",
    "functions": """SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema()
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
      ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)""",
    "enums": """SELECT t.typname AS object,e.enumlabel AS name,e.enumsortorder::text AS position
      FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname=current_schema() ORDER BY t.typname,e.enumsortorder""",
}


def canonical_check(value):
    """pg_dump may distribute a varchar[] -> text[] cast to each literal.

    Normalize only that lossless literal-array rewrite, never arbitrary casts,
    operators, column types or the actual set of permitted strings.
    """
    if not value.startswith("CHECK"):
        return value
    literal = r"'(?:[^']|'')*'"
    array_cast = rf"\(ARRAY\[((?:{literal}::character varying(?:,\s*)?)+)\]\)::text\[\]"
    element_cast = rf"ARRAY\[((?:\({literal}::character varying\)::text(?:,\s*)?)+)\]"

    def whole(match):
        values = re.findall(rf"({literal})::character varying", match[1])
        return "ARRAY[" + ", ".join(item + "::text" for item in values) + "]"

    def elements(match):
        values = re.findall(rf"\(({literal})::character varying\)::text", match[1])
        return "ARRAY[" + ", ".join(item + "::text" for item in values) + "]"

    return re.sub(element_cast, elements, re.sub(array_cast, whole, value))


async def schema_inventory(connection):
    schema = await connection.scalar(text("SELECT current_schema()"))

    def normalize(value, check=False):
        if isinstance(value, str):
            value = value.replace(f'"{schema}".', "").replace(f"{schema}.", "")
            return canonical_check(value) if check else value
        return value

    return {
        kind: [
            {key: normalize(value, kind == "constraints") for key, value in row.items()}
            for row in (await connection.execute(text(query))).mappings()
        ]
        for kind, query in QUERIES.items()
    }


async def reference_inventory(connection, revision):
    original = await connection.scalar(text("SELECT current_schema()"))
    temporary = "migration_reference_" + uuid.uuid4().hex
    await connection.execute(text(f'CREATE SCHEMA "{temporary}"'))
    await connection.execute(text(f'SET LOCAL search_path TO "{temporary}"'))
    await connection.run_sync(upgrade_connection, revision)
    result = await schema_inventory(connection)
    await connection.execute(text(f'SET LOCAL search_path TO "{original}"'))
    await connection.execute(text(f'DROP SCHEMA "{temporary}" CASCADE'))
    return result


def differences(expected, actual):
    return [kind for kind in expected if actual.get(kind) != expected[kind]]
