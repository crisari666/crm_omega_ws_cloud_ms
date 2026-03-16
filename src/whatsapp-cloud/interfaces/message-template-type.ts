interface Language {
  code: string;
  policy?: 'deterministic' | 'fallback';
}

interface Parameter {
  type: 'text' | 'image' | 'document' | 'video';
  text?: string;
  parameter_name?: string;
  image?: {
    link: string;
  };
  document?: {
    link: string;
  };
  video?: {
    link: string;
  };
}

interface Component {
  type: 'body' | 'header' | 'footer' | 'buttons';
  
  parameters: Parameter[];
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

export type { WhatsAppMessageTemplate, Template, Component, Parameter, Language };
