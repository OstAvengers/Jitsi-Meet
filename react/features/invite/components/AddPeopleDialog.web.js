// @flow

import Avatar from '@atlaskit/avatar';
import InlineMessage from '@atlaskit/inline-message';
import PropTypes from 'prop-types';
import React, { Component } from 'react';
import { connect } from 'react-redux';

import { createInviteDialogEvent, sendAnalytics } from '../../analytics';
import { getInviteURL } from '../../base/connection';
import { Dialog, hideDialog } from '../../base/dialog';
import { translate } from '../../base/i18n';
import { MultiSelectAutocomplete } from '../../base/react';
import { inviteVideoRooms } from '../../videosipgw';

import {
    sendInvitesForItems,
    getInviteResultsForQuery
} from '../functions';

const logger = require('jitsi-meet-logger').getLogger(__filename);

declare var interfaceConfig: Object;

/**
 * The dialog that allows to invite people to the call.
 */
class AddPeopleDialog extends Component<*, *> {
    /**
     * {@code AddPeopleDialog}'s property types.
     *
     * @static
     */
    static propTypes = {
        /**
         * The {@link JitsiMeetConference} which will be used to invite "room"
         * participants through the SIP Jibri (Video SIP gateway).
         */
        _conference: PropTypes.object,

        /**
         * The URL for validating if a phone number can be called.
         */
        _dialOutAuthUrl: PropTypes.string,

        /**
         * The URL pointing to the service allowing for people invite.
         */
        _inviteServiceUrl: PropTypes.string,

        /**
         * The url of the conference to invite people to.
         */
        _inviteUrl: PropTypes.string,

        /**
         * The JWT token.
         */
        _jwt: PropTypes.string,

        /**
         * The query types used when searching people.
         */
        _peopleSearchQueryTypes: PropTypes.arrayOf(PropTypes.string),

        /**
         * The URL pointing to the service allowing for people search.
         */
        _peopleSearchUrl: PropTypes.string,

        /**
         * Whether or not to show Add People functionality.
         */
        enableAddPeople: PropTypes.bool,

        /**
         * Whether or not to show Dial Out functionality.
         */
        enableDialOut: PropTypes.bool,

        /**
         * The function closing the dialog.
         */
        hideDialog: PropTypes.func,

        /**
         * Used to invite video rooms.
         */
        inviteVideoRooms: PropTypes.func,

        /**
         * Invoked to obtain translated strings.
         */
        t: PropTypes.func
    };

    _multiselect = null;

    _resourceClient: Object;

    state = {
        /**
         * Indicating that an error occurred when adding people to the call.
         */
        addToCallError: false,

        /**
         * Indicating that we're currently adding the new people to the
         * call.
         */
        addToCallInProgress: false,

        /**
         * The list of invite items.
         */
        inviteItems: []
    };

    /**
     * Initializes a new {@code AddPeopleDialog} instance.
     *
     * @param {Object} props - The read-only properties with which the new
     * instance is to be initialized.
     */
    constructor(props) {
        super(props);

        // Bind event handlers so they are only bound once per instance.
        this._isAddDisabled = this._isAddDisabled.bind(this);
        this._onItemSelected = this._onItemSelected.bind(this);
        this._onSelectionChange = this._onSelectionChange.bind(this);
        this._onSubmit = this._onSubmit.bind(this);
        this._parseQueryResults = this._parseQueryResults.bind(this);
        this._query = this._query.bind(this);
        this._setMultiSelectElement = this._setMultiSelectElement.bind(this);

        this._resourceClient = {
            makeQuery: this._query,
            parseResults: this._parseQueryResults
        };
    }

    /**
     * Sends an analytics event to record the dialog has been shown.
     *
     * @inheritdoc
     * @returns {void}
     */
    componentDidMount() {
        sendAnalytics(createInviteDialogEvent(
            'invite.dialog.opened', 'dialog'));
    }

    /**
     * React Component method that executes once component is updated.
     *
     * @param {Object} prevState - The state object before the update.
     * @returns {void}
     */
    componentDidUpdate(prevState) {
        /**
         * Clears selected items from the multi select component on successful
         * invite.
         */
        if (prevState.addToCallError
                && !this.state.addToCallInProgress
                && !this.state.addToCallError
                && this._multiselect) {
            this._multiselect.setSelectedItems([]);
        }
    }

    /**
     * Sends an analytics event to record the dialog has been closed.
     *
     * @inheritdoc
     * @returns {void}
     */
    componentWillUnmount() {
        sendAnalytics(createInviteDialogEvent(
            'invite.dialog.closed', 'dialog'));
    }

    /**
     * Renders the content of this component.
     *
     * @returns {ReactElement}
     */
    render() {
        const { enableAddPeople, enableDialOut, t } = this.props;
        let isMultiSelectDisabled = this.state.addToCallInProgress || false;
        let placeholder;
        let loadingMessage;
        let noMatches;

        if (enableAddPeople && enableDialOut) {
            loadingMessage = 'addPeople.loading';
            noMatches = 'addPeople.noResults';
            placeholder = 'addPeople.searchPeopleAndNumbers';
        } else if (enableAddPeople) {
            loadingMessage = 'addPeople.loadingPeople';
            noMatches = 'addPeople.noResults';
            placeholder = 'addPeople.searchPeople';
        } else if (enableDialOut) {
            loadingMessage = 'addPeople.loadingNumber';
            noMatches = 'addPeople.noValidNumbers';
            placeholder = 'addPeople.searchNumbers';
        } else {
            isMultiSelectDisabled = true;
            noMatches = 'addPeople.noResults';
            placeholder = 'addPeople.disabled';
        }

        return (
            <Dialog
                okDisabled = { this._isAddDisabled() }
                okTitleKey = 'addPeople.add'
                onSubmit = { this._onSubmit }
                titleKey = 'addPeople.title'
                width = 'medium'>
                <div className = 'add-people-form-wrap'>
                    { this._renderErrorMessage() }
                    <MultiSelectAutocomplete
                        isDisabled = { isMultiSelectDisabled }
                        loadingMessage = { t(loadingMessage) }
                        noMatchesFound = { t(noMatches) }
                        onItemSelected = { this._onItemSelected }
                        onSelectionChange = { this._onSelectionChange }
                        placeholder = { t(placeholder) }
                        ref = { this._setMultiSelectElement }
                        resourceClient = { this._resourceClient }
                        shouldFitContainer = { true }
                        shouldFocus = { true } />
                </div>
            </Dialog>
        );
    }

    /**
     * Helper for determining how many of each type of user is being invited.
     * Used for logging and sending analytics related to invites.
     *
     * @param {Array} inviteItems - An array with the invite items, as created
     * in {@link _parseQueryResults}.
     * @private
     * @returns {Object} An object with keys as user types and values as the
     * number of invites for that type.
     */
    _getInviteTypeCounts(inviteItems = []) {
        const inviteTypeCounts = {};

        inviteItems.forEach(i => {
            const type = i.item.type;

            if (!inviteTypeCounts[type]) {
                inviteTypeCounts[type] = 0;
            }

            inviteTypeCounts[type]++;
        });

        return inviteTypeCounts;
    }

    _isAddDisabled: () => boolean;

    /**
     * Indicates if the Add button should be disabled.
     *
     * @private
     * @returns {boolean} - True to indicate that the Add button should
     * be disabled, false otherwise.
     */
    _isAddDisabled() {
        return !this.state.inviteItems.length
            || this.state.addToCallInProgress;
    }

    _onItemSelected: (Object) => Object;

    /**
     * Callback invoked when a selection has been made but before it has been
     * set as selected.
     *
     * @param {Object} item - The item that has just been selected.
     * @private
     * @returns {Object} The item to display as selected in the input.
     */
    _onItemSelected(item) {
        if (item.item.type === 'phone') {
            item.content = item.item.number;
        }

        return item;
    }

    _onSelectionChange: (Map<*, *>) => void;

    /**
     * Handles a selection change.
     *
     * @param {Map} selectedItems - The list of selected items.
     * @private
     * @returns {void}
     */
    _onSelectionChange(selectedItems) {
        this.setState({
            inviteItems: selectedItems
        });
    }

    _onSubmit: () => void;

    /**
     * Invite people and numbers to the conference. The logic works by inviting
     * numbers, people/rooms, and videosipgw in parallel. All invitees are
     * stored in an array. As each invite succeeds, the invitee is removed
     * from the array. After all invites finish, close the modal if there are
     * no invites left to send. If any are left, that means an invite failed
     * and an error state should display.
     *
     * @private
     * @returns {void}
     */
    _onSubmit() {
        const inviteTypeCounts
            = this._getInviteTypeCounts(this.state.inviteItems);

        sendAnalytics(createInviteDialogEvent(
            'clicked', 'inviteButton', {
                ...inviteTypeCounts,
                inviteAllowed: this._isAddDisabled()
            }));

        if (this._isAddDisabled()) {
            return;
        }

        this.setState({
            addToCallInProgress: true
        });

        const {
            _conference,
            _inviteServiceUrl,
            _inviteUrl,
            _jwt
        } = this.props;

        const inviteItems = this.state.inviteItems;
        const items = inviteItems.map(item => item.item);

        const options = {
            conference: _conference,
            inviteServiceUrl: _inviteServiceUrl,
            inviteUrl: _inviteUrl,
            inviteVideoRooms: this.props.inviteVideoRooms,
            jwt: _jwt
        };

        sendInvitesForItems(items, options)
            .then(invitesLeftToSend => {
                // If any invites are left that means something failed to send
                // so treat it as an error.
                if (invitesLeftToSend.length) {
                    const erroredInviteTypeCounts
                        = this._getInviteTypeCounts(invitesLeftToSend);

                    logger.error(`${invitesLeftToSend.length} invites failed`,
                        erroredInviteTypeCounts);

                    sendAnalytics(createInviteDialogEvent(
                        'error', 'invite', {
                            ...erroredInviteTypeCounts
                        }));

                    this.setState({
                        addToCallInProgress: false,
                        addToCallError: true
                    });

                    const unsentInviteIDs = invitesLeftToSend.map(invite =>
                        invite.id || invite.number
                    );

                    const itemsToSelect = inviteItems.filter(invite =>
                        unsentInviteIDs.includes(
                            invite.item.id || invite.item.number
                        )
                    );

                    if (this._multiselect) {
                        this._multiselect.setSelectedItems(itemsToSelect);
                    }

                    return;
                }

                this.setState({
                    addToCallInProgress: false
                });

                this.props.hideDialog();
            });
    }

    _parseQueryResults: (Array<Object>, string) => Array<Object>;

    /**
     * Processes results from requesting available numbers and people by munging
     * each result into a format {@code MultiSelectAutocomplete} can use for
     * display.
     *
     * @param {Array} response - The response object from the server for the
     * query.
     * @private
     * @returns {Object[]} Configuration objects for items to display in the
     * search autocomplete.
     */
    _parseQueryResults(response = []) {
        const { t } = this.props;
        const users = response.filter(item => item.type !== 'phone');
        const userDisplayItems = users.map(user => {
            return {
                content: user.name,
                elemBefore: <Avatar
                    size = 'small'
                    src = { user.avatar } />,
                item: user,
                tag: {
                    elemBefore: <Avatar
                        size = 'xsmall'
                        src = { user.avatar } />
                },
                value: user.id
            };
        });

        const numbers = response.filter(item => item.type === 'phone');
        const telephoneIcon = this._renderTelephoneIcon();

        const numberDisplayItems = numbers.map(number => {
            const numberNotAllowedMessage
                = number.allowed ? '' : t('addPeople.countryNotSupported');
            const countryCodeReminder = number.showCountryCodeReminder
                ? t('addPeople.countryReminder') : '';
            const description
                = `${numberNotAllowedMessage} ${countryCodeReminder}`.trim();

            return {
                filterValues: [
                    number.originalEntry,
                    number.number
                ],
                content: t('addPeople.telephone', { number: number.number }),
                description,
                isDisabled: !number.allowed,
                elemBefore: telephoneIcon,
                item: number,
                tag: {
                    elemBefore: telephoneIcon
                },
                value: number.number
            };
        });

        return [
            ...userDisplayItems,
            ...numberDisplayItems
        ];
    }

    _query: (string) => Promise<Array<Object>>;

    /**
     * Performs a people and phone number search request.
     *
     * @param {string} query - The search text.
     * @private
     * @returns {Promise}
     */
    _query(query = '') {
        const {
            enableAddPeople,
            enableDialOut,
            _dialOutAuthUrl,
            _jwt,
            _peopleSearchQueryTypes,
            _peopleSearchUrl
        } = this.props;

        const options = {
            dialOutAuthUrl: _dialOutAuthUrl,
            enableAddPeople,
            enableDialOut,
            jwt: _jwt,
            peopleSearchQueryTypes: _peopleSearchQueryTypes,
            peopleSearchUrl: _peopleSearchUrl
        };

        return getInviteResultsForQuery(query, options);
    }

    /**
     * Renders the error message if the add doesn't succeed.
     *
     * @private
     * @returns {ReactElement|null}
     */
    _renderErrorMessage() {
        if (!this.state.addToCallError) {
            return null;
        }

        const { t } = this.props;
        const supportString = t('inlineDialogFailure.supportMsg');
        const supportLink = interfaceConfig.SUPPORT_URL;
        const supportLinkContent
            = ( // eslint-disable-line no-extra-parens
                <span>
                    <span>
                        { supportString.padEnd(supportString.length + 1) }
                    </span>
                    <span>
                        <a
                            href = { supportLink }
                            rel = 'noopener noreferrer'
                            target = '_blank'>
                            { t('inlineDialogFailure.support') }
                        </a>
                    </span>
                    <span>.</span>
                </span>
            );

        return (
            <div className = 'modal-dialog-form-error'>
                <InlineMessage
                    title = { t('addPeople.failedToAdd') }
                    type = 'error'>
                    { supportLinkContent }
                </InlineMessage>
            </div>
        );
    }

    /**
     * Renders a telephone icon.
     *
     * @private
     * @returns {ReactElement}
     */
    _renderTelephoneIcon() {
        return (
            <span className = 'add-telephone-icon'>
                <i className = 'icon-telephone' />
            </span>
        );
    }

    _setMultiSelectElement: (React$ElementRef<*> | null) => mixed;

    /**
     * Sets the instance variable for the multi select component
     * element so it can be accessed directly.
     *
     * @param {Object} element - The DOM element for the component's dialog.
     * @private
     * @returns {void}
     */
    _setMultiSelectElement(element) {
        this._multiselect = element;
    }
}

/**
 * Maps (parts of) the Redux state to the associated
 * {@code AddPeopleDialog}'s props.
 *
 * @param {Object} state - The Redux state.
 * @private
 * @returns {{
 *     _conference: Object,
 *     _dialOutAuthUrl: string,
 *     _inviteServiceUrl: string,
 *     _inviteUrl: string,
 *     _jwt: string,
 *     _peopleSearchQueryTypes: Array<string>,
 *     _peopleSearchUrl: string
 * }}
 */
function _mapStateToProps(state) {
    const { conference } = state['features/base/conference'];
    const {
        dialOutAuthUrl,
        inviteServiceUrl,
        peopleSearchQueryTypes,
        peopleSearchUrl
    } = state['features/base/config'];

    return {
        _conference: conference,
        _dialOutAuthUrl: dialOutAuthUrl,
        _inviteServiceUrl: inviteServiceUrl,
        _inviteUrl: getInviteURL(state),
        _jwt: state['features/base/jwt'].jwt,
        _peopleSearchQueryTypes: peopleSearchQueryTypes,
        _peopleSearchUrl: peopleSearchUrl
    };
}

export default translate(connect(_mapStateToProps, {
    hideDialog,
    inviteVideoRooms })(
    AddPeopleDialog));
