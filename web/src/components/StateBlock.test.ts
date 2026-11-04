import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import StateBlock from './StateBlock.vue';

describe('StateBlock', () => {
  it('shows the error with an alert role instead of content', () => {
    const wrapper = mount(StateBlock, {
      props: { loading: false, error: 'Request failed with status 500.', emptyText: 'Nothing.' },
      slots: { default: '<p>content</p>' },
    });
    expect(wrapper.get('[role="alert"]').text()).toContain('Request failed with status 500.');
    expect(wrapper.text()).not.toContain('content');
  });

  it('shows a loading status while the request is in flight', () => {
    const wrapper = mount(StateBlock, { props: { loading: true, error: null, emptyText: 'Nothing.' } });
    expect(wrapper.get('[role="status"]').text()).toContain('Loading');
  });

  it('shows the empty text when there is no data', () => {
    const wrapper = mount(StateBlock, { props: { loading: false, error: null, empty: true, emptyText: 'No keys yet.' } });
    expect(wrapper.text()).toBe('No keys yet.');
  });

  it('renders its content when data is present', () => {
    const wrapper = mount(StateBlock, {
      props: { loading: false, error: null, empty: false, emptyText: 'Nothing.' },
      slots: { default: '<table><tr><td>row</td></tr></table>' },
    });
    expect(wrapper.find('table').exists()).toBe(true);
  });
});
