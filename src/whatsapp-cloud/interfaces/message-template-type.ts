interface Language {
  code: string;
  policy?: 'deterministic' | 'fallback';
}

interface TextMediaParameter {
  type: 'text' | 'image' | 'document' | 'video';
  text?: string;
  parameter_name?: string;
  image?: {
    id?: string;
    link?: string;
  };
  document?: {
    id?: string;
    link?: string;
  };
  video?: {
    id?: string;
    caption?: string;
    link?: string;
  };
}

interface FlowActionParameter {
  type: 'action';
  action: {
    flow_token: string;
    flow_action_data?: Record<string, unknown>;
  };
}

type Parameter = TextMediaParameter | FlowActionParameter;

interface Component {
  type: 'body' | 'header' | 'footer' | 'button';
  sub_type?: 'url' | 'flow' | 'quick_reply' | 'copy_code' | 'phone_number';
  parameters: Parameter[];
  index?: number | string;
}

interface Template {
  name: string;
  namespace?: string;
  language?: Language;
  components?: Component[];
}

interface WhatsAppMessageTemplate {
  to: string;
  messaging_product: "whatsapp";
  recipient_type: "individual";
  type: "template";
  template: Template;
}

export type {
  WhatsAppMessageTemplate,
  Template,
  Component,
  Parameter,
  TextMediaParameter,
  FlowActionParameter,
  Language,
};
