use schemasync_core::{diff::diff, parse::parse_schema};
use std::fs;
use std::path::Path;

#[test]
fn golden_fixtures() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let mut ran = 0;
    for entry in fs::read_dir(&fixtures).expect("fixtures dir exists") {
        let dir = entry.unwrap().path();
        if !dir.is_dir() {
            continue;
        }
        let name = dir.file_name().unwrap().to_string_lossy().to_string();
        let old_sql = fs::read_to_string(dir.join("old.sql")).unwrap();
        let new_sql = fs::read_to_string(dir.join("new.sql")).unwrap();
        let expected: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("expected.json")).unwrap()).unwrap();

        let old = parse_schema(&old_sql).unwrap_or_else(|e| panic!("{name}/old.sql: {e}"));
        let new = parse_schema(&new_sql).unwrap_or_else(|e| panic!("{name}/new.sql: {e}"));
        let actual = serde_json::to_value(diff(&old, &new)).unwrap();

        assert_eq!(actual, expected, "fixture {name} mismatch");
        ran += 1;
    }
    assert_eq!(ran, 5, "expected 5 golden fixtures");
}
