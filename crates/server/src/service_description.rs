use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct ServiceDescriptionItem {
    pub id: String,
    pub text: String,
}

pub(crate) fn normalize_items(
    items: Vec<ServiceDescriptionItem>,
) -> Result<Vec<ServiceDescriptionItem>, &'static str> {
    let mut ids = std::collections::HashSet::new();
    let mut normalized = Vec::new();
    for item in items {
        let id = item.id.trim().to_string();
        let text = item.text.trim().to_string();
        if id.is_empty() || !ids.insert(id.clone()) {
            return Err("Description item IDs must be non-empty and unique");
        }
        if text.is_empty() {
            return Err("Description item text is required");
        }
        normalized.push(ServiceDescriptionItem { id, text });
    }
    Ok(normalized)
}

pub(crate) fn items_text(items: &[ServiceDescriptionItem]) -> Option<String> {
    let text = items
        .iter()
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    (!text.is_empty()).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_order_and_internal_paragraphs() {
        let items = normalize_items(vec![
            ServiceDescriptionItem {
                id: "b".into(),
                text: " One\n\ntwo ".into(),
            },
            ServiceDescriptionItem {
                id: "a".into(),
                text: "Three".into(),
            },
        ])
        .unwrap();
        assert_eq!(items[0].id, "b");
        assert_eq!(items_text(&items).as_deref(), Some("One\n\ntwo\n\nThree"));
        assert_eq!(items_text(&[]), None);
    }

    #[test]
    fn rejects_duplicate_ids_and_empty_text() {
        let item = ServiceDescriptionItem {
            id: "a".into(),
            text: "One".into(),
        };
        assert!(normalize_items(vec![item.clone(), item]).is_err());
        assert!(
            normalize_items(vec![ServiceDescriptionItem {
                id: "a".into(),
                text: " ".into(),
            }])
            .is_err()
        );
    }
}
