"use client";

import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ProductCategory } from "@/lib/types";
import styles from "./upload.module.css";

const categories = ["electronics", "appliance", "3c", "toy", "home", "battery", "cosmetic", "textile", "food_contact", "other"] as const;

export function CategorySelect({ value, onChange, labels, disabled }: {
  value: ProductCategory;
  onChange: (value: ProductCategory) => void;
  labels: Record<ProductCategory, string>;
  disabled: boolean;
}) {
  return <Select.Root value={value} onValueChange={(next) => { if (next) onChange(next); }} disabled={disabled}
    items={categories.map((id) => ({ value: id, label: labels[id] }))}>
    <Select.Trigger id="blaze-category" className={styles.categoryTrigger}>
      <Select.Value />
      <Select.Icon className={styles.categoryChevron}><ChevronDown size={16} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner sideOffset={8} alignItemWithTrigger={false} className={styles.categoryPositioner}>
        <Select.Popup className={styles.categoryPopup}>
          <Select.List className={styles.categoryList}>
            {categories.map((id) => <Select.Item key={id} value={id} className={styles.categoryItem}>
              <Select.ItemText>{labels[id]}</Select.ItemText>
              <Select.ItemIndicator><Check size={16} /></Select.ItemIndicator>
            </Select.Item>)}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>;
}
