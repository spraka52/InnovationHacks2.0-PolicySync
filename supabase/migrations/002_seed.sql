-- Seed initial sources for demo (TX + CA, Employer + Medicare focus)
insert into sources (name, plan_type, state, fetch_url, fetch_method, active) values
  -- Medicare (national)
  ('CMS Medicare Coverage Database - NCD/LCD', 'medicare', null,
   'https://www.cms.gov/medicare-coverage-database/api/articles?'||
   'IsPrimary=true&kq=true&KeyWord=GLP-1&KeyWordLookUp=Title&KeyWordSearchType=And&aKey=0&bc=AAAAAAAAAQAA&',
   'api', true),

  -- VA/TRICARE (national)
  ('VA National Formulary', 'va_tricare', null,
   'https://www.pbm.va.gov/nationalformulary.asp',
   'html', true),

  -- Employer — TX (UHC public medical policies)
  ('UnitedHealthcare Medical Policy Index - TX', 'employer', 'TX',
   'https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/glucagon-like-peptide-1-glp1-receptor-agonists-obesity.pdf',
   'pdf', true),

  -- Employer — CA
  ('UnitedHealthcare Medical Policy Index - CA', 'employer', 'CA',
   'https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/glucagon-like-peptide-1-glp1-receptor-agonists-obesity.pdf',
   'pdf', true),

  -- Medicaid TX
  ('Texas Medicaid VDP Formulary', 'medicaid', 'TX',
   'https://www.txvendordrug.com/formulary/formulary-search',
   'html', true),

  -- Medicaid CA
  ('Medi-Cal Rx Drug List', 'medicaid', 'CA',
   'https://medi-calrx.dhcs.ca.gov/cms/medicalrx/static-assets/documents/provider/forms_and_information/Medi-Cal_Rx_Contract_Drug_List_CDL.pdf',
   'pdf', true),

  -- Marketplace (CMS QHP Formulary data)
  ('CMS QHP Formulary - TX Plans', 'marketplace', 'TX',
   'https://data.healthcare.gov/api/1/datastore/query/b10bc098-ce63-5b9a-9de6-84e0ba51b8f4/0?'||
   'conditions[0][property]=StateCode&conditions[0][value]=TX&conditions[0][operator]=%3D&limit=1000',
   'api', true),

  ('CMS QHP Formulary - CA Plans', 'marketplace', 'CA',
   'https://data.healthcare.gov/api/1/datastore/query/b10bc098-ce63-5b9a-9de6-84e0ba51b8f4/0?'||
   'conditions[0][property]=StateCode&conditions[0][value]=CA&conditions[0][operator]=%3D&limit=1000',
   'api', true);

-- Seed default admin config
insert into admin_config (selected_states, enabled_plan_types, updated_by)
values (
  array['TX', 'CA'],
  array['employer', 'medicaid', 'marketplace', 'medicare', 'va_tricare'],
  'system'
);
