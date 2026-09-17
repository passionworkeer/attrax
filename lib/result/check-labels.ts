/** UI names for fixed checks; observed label text remains verbatim. */
const labels: Record<string, [string, string]> = {
  "common.product.overview": ["产品整体外观", "Product overview"],
  "common.nameplate.readability": ["铭牌清晰度", "Label readability"],
  "common.certification_marks.visible": ["认证与安全标识", "Certification and safety marks"],
  "common.brand_model.visible": ["品牌与型号", "Brand and model"],
  "common.batch_traceability.fields": ["批次与追溯信息", "Batch and traceability"],
  "common.warning_text.language": ["警示语与语言", "Warnings and language"],
  "common.packaging.info": ["包装信息", "Packaging information"],
  "common.defects.visible": ["可见外观异常", "Visible surface defects"],
  "electronics.nameplate.electrical_ratings": ["额定电压与功率", "Electrical ratings"],
  "electronics.interface.plug_pins": ["接口与插脚", "Ports and plug pins"],
  "electronics.cable.connector_condition": ["线缆与接头", "Cable and connectors"],
  "electronics.marks.certification_region": ["认证标识区域", "Certification mark area"],
  "electronics.adapter.external_power": ["外置适配器（如有）", "External adapter, if supplied"],
  "electronics.safety.electrical_test": ["电气安全测试报告", "Electrical safety test report"],
  "electronics.emc.test_report": ["EMC 测试报告", "EMC test report"],
  "appliance.nameplate.ratings": ["家电铭牌参数", "Appliance ratings"],
  "appliance.power_entry.visible": ["插头与供电入口", "Power connection"],
  "appliance.functional_zones.condition": ["功能区域外观", "Functional areas"],
  "appliance.water_temp_warnings.text": ["水位与温度警告", "Water and temperature warnings"],
  "appliance.ip_rating.marking": ["防护等级标注", "IP rating marking"],
  "appliance.safety.electrical_test": ["家电安全测试报告", "Appliance safety report"],
  "toy.age_range.label": ["适用年龄标注", "Age marking"],
  "toy.warnings.text": ["玩具警示语", "Toy warnings"],
  "toy.small_parts.visible": ["可见小零件", "Visible small parts"],
  "toy.magnets_cords.visible": ["磁体与绳带", "Magnets and cords"],
  "toy.battery_compartment.closure": ["电池仓闭合方式", "Battery compartment closure"],
  "toy.sharp_edges.visible": ["可见尖角与锐边", "Visible sharp edges"],
  "toy.mechanical_physical.test": ["机械物理测试报告", "Mechanical and physical testing"],
  "toy.chemical_migration.test": ["化学迁移测试报告", "Chemical migration testing"],
};

export function checkLabel(checkId: string, locale: "zh" | "en", fallback: string): string {
  return labels[checkId]?.[locale === "zh" ? 0 : 1] ?? fallback;
}

const views: Record<string,string> = {
  front:"产品正面照",back:"产品背面照",side:"产品侧面照",overview:"整体照",overall:"整体照",
  nameplate_closeup:"铭牌近照",bottom_nameplate:"底部铭牌近照",ports_closeup:"接口近照",plug_closeup:"插头近照",cable_closeup:"线缆近照",adapter_closeup:"适配器近照",
  package:"包装照",packaging:"包装照",package_front:"包装正面照",warning_label_closeup:"警告标签近照",warning_label:"警告标签照",label_closeup:"标签近照",
  power_side:"供电端照片",functional_side:"功能区域照片",terminal_closeup:"电池端子近照",battery_compartment:"电池仓照片",accessories_flat:"附件平铺照",
  case_bottom:"外壳底部照",case_closeup:"外壳近照",inner_surface:"内表面照片",bottom_label:"底部标签照",label_front:"正面标签照",label_back:"背面标签照",bottom_batch:"底部批号照",
  care_label_closeup:"洗护标签近照",all_sewn_labels:"全部缝制标签照",overview_front:"整体正面照",overview_back:"整体背面照",label:"标签照",manual:"说明书页",
};
/** Translate fixed capture-slot identifiers, without rewriting evidence quotations. */
export function actionLabel(action:string, locale:"zh"|"en"):string {
  if(locale!=="zh")return action;
  return action.replace(/[a-z]+(?:_[a-z]+)*/g, token=>views[token]??token);
}

export function declarationLabel(field:string,value:string,locale:"zh"|"en") {
  const names:Record<string,string>={battery:"是否内置或随附电池",wireless:"是否含无线功能",input_voltage:"输入电压",adapter_included:"是否随附适配器",mains:"是否使用市电",heating_or_motor:"是否含加热或电机部件",usage_scenario:"使用场景",age_grade:"适用年龄",magnets:"磁体",cords_ropes:"绳带",child_use:"儿童使用",load_capacity:"标称承重",electrical:"电气部件",battery_chemistry:"电池类型",capacity_wh:"电池容量范围",usage:"用途",purpose:"产品用途",target_group:"目标人群",claims:"功效宣称",age_group:"适用人群",drawstrings:"绳带",protective_use:"防护用途",food_contact:"直接接触食品",temperature:"接触温度",reuse:"重复使用",subcategory:"产品子类"};
  const values:Record<string,string>={present:"是",absent:"否",unknown:"不确定"};
  return locale==="zh"?{name:names[field]||field,value:values[value]||value}:{name:field.replaceAll("_"," "),value};
}
