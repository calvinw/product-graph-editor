import type { LcaResult } from "../../src/lib/lcaApi"

// A real run_lca_base response for the "Simple Mock Plastic Broom" template, captured
// from lca.mathplosion.com on 2026-10-04. Unlike the Jacket fixture it carries
// background_link_intensities, so the scaled graph has draggable scenario edges.
export const broomLcaResultFixture: LcaResult = {
  "result_id": "bae069f5ecc4202994c42675495e576181c16c35406076f74275e73cbe0ee5af",
  "name": "Simple Mock Plastic Broom — 1 unit",
  "method": "EF v3.1",
  "functional_unit": "1.0 unit — 1 simple mock plastic broom",
  "lci": {
    "Sulfur dioxide": {
      "amount": 0.0005825500056946931,
      "unit": "kilogram",
      "type": "emission"
    },
    "Carbon dioxide, fossil": {
      "amount": 0.945494972040057,
      "unit": "kilogram",
      "type": "emission"
    }
  },
  "lcia": {
    "acidification | accumulated exceedance (AE)": {
      "score": 0.0007631404741262694,
      "unit": "mol H+-Eq"
    },
    "climate change | global warming potential (GWP100)": {
      "score": 0.945494972040057,
      "unit": "kg CO2-Eq"
    }
  },
  "scaling_vector": {
    "Simple mock plastic broom assembly": 1
  },
  "result_schema_version": 3,
  "process_contributions": {
    "categories": [
      {
        "id": "impact:ef-v3-1:0ebf0e0b8353",
        "label": "acidification | accumulated exceedance (AE)",
        "unit": "mol H+-Eq",
        "total_score": 0.0007631404741262694,
        "processes": [
          {
            "process_id": "process:simple-mock-plastic-broom-assembly:80c1522f80bc",
            "process_name": "Simple mock plastic broom assembly",
            "direct_score": 0,
            "percentage": 0,
            "scope": "foreground"
          },
          {
            "process_id": "background-process:mock-background:55efa4e77542",
            "process_name": "Mock grid electricity, medium voltage",
            "direct_score": 0.00040871998656861395,
            "percentage": 53.55763459362621,
            "scope": "background"
          },
          {
            "process_id": "background-process:mock-background:5210740efa73",
            "process_name": "Mock polypropylene granulate, at plant",
            "direct_score": 0.0003405999888071783,
            "percentage": 44.63136216135518,
            "scope": "background"
          },
          {
            "process_id": "background-process:mock-background:6aa2ea7db2fd",
            "process_name": "Mock freight transport, small truck, direct emissions only",
            "direct_score": 0.000013820498750477074,
            "percentage": 1.8110032450186004,
            "scope": "background"
          }
        ],
        "residual_score": 0
      },
      {
        "id": "impact:ef-v3-1:8e6f6720eb3d",
        "label": "climate change | global warming potential (GWP100)",
        "unit": "kg CO2-Eq",
        "total_score": 0.945494972040057,
        "processes": [
          {
            "process_id": "process:simple-mock-plastic-broom-assembly:80c1522f80bc",
            "process_name": "Simple mock plastic broom assembly",
            "direct_score": 0,
            "percentage": 0,
            "scope": "foreground"
          },
          {
            "process_id": "background-process:mock-background:5210740efa73",
            "process_name": "Mock polypropylene granulate, at plant",
            "direct_score": 0.5199999809265137,
            "percentage": 54.99764634438302,
            "scope": "background"
          },
          {
            "process_id": "background-process:mock-background:55efa4e77542",
            "process_name": "Mock grid electricity, medium voltage",
            "direct_score": 0.41599999094009377,
            "percentage": 43.998117731129454,
            "scope": "background"
          },
          {
            "process_id": "background-process:mock-background:6aa2ea7db2fd",
            "process_name": "Mock freight transport, small truck, direct emissions only",
            "direct_score": 0.009495000173449506,
            "percentage": 1.0042359244875223,
            "scope": "background"
          }
        ],
        "residual_score": 0
      }
    ]
  },
  "contribution_graphs": [],
  "sankey": {
    "nodes": [
      {
        "id": "process:simple-mock-plastic-broom-assembly:80c1522f80bc",
        "label": "Simple mock plastic broom assembly",
        "kind": "process",
        "process_name": "Simple mock plastic broom assembly",
        "scope": "foreground"
      },
      {
        "id": "background-process:mock-background:5210740efa73",
        "label": "Mock polypropylene granulate, at plant",
        "kind": "process",
        "process_name": "Mock polypropylene granulate, at plant",
        "scope": "background"
      },
      {
        "id": "background-process:mock-background:6aa2ea7db2fd",
        "label": "Mock freight transport, small truck, direct emissions only",
        "kind": "process",
        "process_name": "Mock freight transport, small truck, direct emissions only",
        "scope": "background"
      },
      {
        "id": "final-product:simple-mock-plastic-broom:55f597729505",
        "label": "1 simple mock plastic broom",
        "kind": "final_product",
        "flow_name": "Simple mock plastic broom"
      }
    ],
    "links": [
      {
        "id": "link:technosphere:3e7610dcbe36",
        "source": "background-process:mock-background:5210740efa73",
        "target": "process:simple-mock-plastic-broom-assembly:80c1522f80bc",
        "kind": "technosphere",
        "flow_name": "Mock polypropylene granulate, at plant",
        "amount": 0.52,
        "unit": "kilogram"
      },
      {
        "id": "link:technosphere:666969dc093e",
        "source": "background-process:mock-background:6aa2ea7db2fd",
        "target": "process:simple-mock-plastic-broom-assembly:80c1522f80bc",
        "kind": "technosphere",
        "flow_name": "Mock freight transport, small truck, direct emissions only",
        "amount": 0.1055,
        "unit": "ton kilometer"
      },
      {
        "id": "link:final-product:e4a64eed6545",
        "source": "process:simple-mock-plastic-broom-assembly:80c1522f80bc",
        "target": "final-product:simple-mock-plastic-broom:55f597729505",
        "kind": "final_product",
        "flow_name": "Simple mock plastic broom",
        "amount": 1,
        "unit": "unit"
      }
    ],
    "available_units": [
      "kilogram",
      "ton kilometer",
      "unit"
    ]
  },
  "background_link_intensities": [
    {
      "link_id": "background-link:simple-mock-plastic-broom-assembly:19b7e3ea269c",
      "process_index": 0,
      "input_index": 0,
      "process_name": "Simple mock plastic broom assembly",
      "flow": "Mock polypropylene granulate, at plant",
      "database": "mock_background",
      "code": "mock-polypropylene",
      "location": "MOCK",
      "amount": 0.52,
      "unit": "kilogram",
      "intensities": {
        "acidification | accumulated exceedance (AE)": 0.0014410000055013195,
        "climate change | global warming potential (GWP100)": 1.800000011920929
      }
    },
    {
      "link_id": "background-link:simple-mock-plastic-broom-assembly:434817a1e8d7",
      "process_index": 0,
      "input_index": 1,
      "process_name": "Simple mock plastic broom assembly",
      "flow": "Mock freight transport, small truck, direct emissions only",
      "database": "mock_background",
      "code": "mock-small-truck-direct",
      "location": "MOCK",
      "amount": 0.1055,
      "unit": "ton kilometer",
      "intensities": {
        "acidification | accumulated exceedance (AE)": 0.0001309999909686159,
        "climate change | global warming potential (GWP100)": 0.09000000357627869
      }
    }
  ]
}
