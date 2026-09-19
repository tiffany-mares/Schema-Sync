pub mod diff;
pub mod model;
pub mod parse;

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

#[pyfunction]
fn parse_schema_json(sql: &str) -> PyResult<String> {
    let schema = parse::parse_schema(sql).map_err(PyValueError::new_err)?;
    Ok(serde_json::to_string(&schema).expect("schema serializes"))
}

#[pyfunction]
fn diff_json(old_json: &str, new_json: &str) -> PyResult<String> {
    let old: model::Schema =
        serde_json::from_str(old_json).map_err(|e| PyValueError::new_err(e.to_string()))?;
    let new: model::Schema =
        serde_json::from_str(new_json).map_err(|e| PyValueError::new_err(e.to_string()))?;
    Ok(serde_json::to_string(&diff::diff(&old, &new)).expect("changes serialize"))
}

#[pymodule]
fn schemasync_core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(parse_schema_json, m)?)?;
    m.add_function(wrap_pyfunction!(diff_json, m)?)?;
    Ok(())
}
